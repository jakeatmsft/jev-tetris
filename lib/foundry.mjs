import "./env.mjs";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
import OpenAI from "openai";
import { jsonResult } from "./typesafe.mjs";

export function foundrySettings(env = process.env) {
  const base = env.AZURE_OPENAI_BASE_URL?.trim();
  const resource = env.AZURE_AI_RESOURCE_ENDPOINT?.trim() || env.AZURE_AI_PROJECT_ENDPOINT?.trim() || base;
  let error = "";
  let origin = "";
  let responsesBaseURL = "";
  let decisionURL = "";
  try {
    if (!resource) throw new Error("Set AZURE_OPENAI_BASE_URL or AZURE_AI_PROJECT_ENDPOINT in .env, then restart the server.");
    origin = new URL(resource).origin;
    responsesBaseURL = base || `${origin}/openai/v1`;
    decisionURL = env.AZURE_DECISION_ENDPOINT?.trim() || `${origin}/providers/microsoft/v1/systemone`;
    for (const url of [responsesBaseURL, decisionURL]) {
      if (new URL(url).protocol !== "https:") throw new Error("Foundry endpoints must use HTTPS.");
    }
  } catch (err) {
    error = err.message;
  }
  return {
    configured: !error,
    error,
    responsesBaseURL,
    decisionURL,
    decisionDeployment: env.AZURE_DECISION_DEPLOYMENT?.trim() || "Decision-1",
    gptDeployment: env.AZURE_GPT_DEPLOYMENT?.trim() || "",
    scope: env.AZURE_TOKEN_SCOPE?.trim() || "https://cognitiveservices.azure.com/.default",
    reasoningEffort: env.GPT_REASONING_EFFORT?.trim() || "none",
    maxOutputTokens: Math.max(64, Math.min(16384, Number(env.GPT_MAX_OUTPUT_TOKENS) || 1024)),
  };
}

let tokenProvider;
let tokenRequest;
async function getToken() {
  const settings = foundrySettings();
  if (!settings.configured) throw new Error(settings.error);
  tokenProvider ??= getBearerTokenProvider(new DefaultAzureCredential(), settings.scope);
  // Share the first token request when both players start at the same time.
  tokenRequest ??= tokenProvider().finally(() => { tokenRequest = null; });
  try {
    return await tokenRequest;
  } catch {
    const error = new Error("Microsoft Entra ID sign-in failed. Run az login on the server, or configure AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_CLIENT_SECRET in .env. The identity needs access to this Foundry resource.");
    error.status = 401;
    throw error;
  }
}

let client;
export function getFoundryClient() {
  return client ??= new OpenAI({
    baseURL: foundrySettings().responsesBaseURL,
    apiKey: getToken,
    maxRetries: 0,
    timeout: 30_000,
  });
}

export function foundryErrorResult(err) {
  const status = err.status || (err.name === "APIConnectionTimeoutError" ? 504 : 502);
  const result = jsonResult(status, {
    detail: {
      error_type: status === 401 || status === 403 ? "authentication_error" : "foundry_error",
      message: err.error?.message || err.message || "Foundry request failed.",
    },
  });
  const retryAfter = err.headers?.get?.("retry-after");
  if (retryAfter) result.headers["Retry-After"] = retryAfter;
  return result;
}

export async function connectionResult() {
  const settings = foundrySettings();
  if (!settings.configured) return jsonResult(503, { detail: { message: settings.error } });
  try {
    await getToken();
    return jsonResult(200, { authenticated: true, auth: "entra", model: settings.decisionDeployment });
  } catch (err) {
    return foundryErrorResult(err);
  }
}

export async function forwardDecision({ body, api = getFoundryClient, settings = foundrySettings() }) {
  if (!settings.configured) return jsonResult(503, { detail: { message: settings.error } });
  let request;
  try {
    request = JSON.parse(body);
    if (!request || request.state == null || !request.questions || typeof request.questions !== "object" || Array.isArray(request.questions)) {
      throw new Error("A decision requires state and questions.");
    }
  } catch (err) {
    return jsonResult(400, { detail: { error_type: "bad_request", message: err.message } });
  }
  try {
    const response = await api().post(settings.decisionURL, {
      body: { state: request.state, questions: request.questions, model: settings.decisionDeployment },
    });
    return jsonResult(200, response);
  } catch (err) {
    return foundryErrorResult(err);
  }
}

export async function forwardGpt({ body, api = getFoundryClient, settings = foundrySettings() }) {
  if (!settings.configured || !settings.gptDeployment) {
    return jsonResult(503, { detail: { message: settings.error || "Set AZURE_GPT_DEPLOYMENT in .env, then restart the server." } });
  }
  let request;
  try {
    request = JSON.parse(body);
    if (!request || typeof request.input !== "string" || !Array.isArray(request.tools)) throw new Error("A GPT move requires input and tools.");
  } catch (err) {
    return jsonResult(400, { detail: { error_type: "bad_request", message: err.message } });
  }
  try {
    const response = await api().responses.create({
      model: settings.gptDeployment,
      instructions: request.instructions,
      input: request.input,
      tools: request.tools,
      tool_choice: { type: "function", name: "place_piece" },
      parallel_tool_calls: false,
      reasoning: { effort: settings.reasoningEffort },
      max_output_tokens: settings.maxOutputTokens,
      store: false,
    });
    return jsonResult(200, response);
  } catch (err) {
    return foundryErrorResult(err);
  }
}
