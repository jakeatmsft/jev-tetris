import "./env.mjs";
import OpenAI from "openai";
import { jsonResult } from "./typesafe.mjs";

export function openaiDecisionSettings(env = process.env) {
  return {
    configured: Boolean(env.OPENAI_API_KEY?.trim()),
    model: env.OPENAI_DECISION_MODEL?.trim() || "gpt-6-luna",
  };
}

let client;
function getClient() {
  return client ??= new OpenAI({
    apiKey: process.env.OPENAI_API_KEY.trim(),
    baseURL: "https://api.openai.com/v1",
    maxRetries: 0,
    timeout: 30_000,
  });
}

export async function forwardOpenaiDecision({ body, settings = openaiDecisionSettings(), api = getClient }) {
  if (!settings.configured) return jsonResult(503, { detail: { message: "Set OPENAI_API_KEY in .env, then restart the server." } });
  let request;
  try {
    request = JSON.parse(body);
    if (!request || typeof request.input !== "string" || !Array.isArray(request.questions) || !request.questions.length) {
      throw new Error("An OpenAI decision requires input and a questions array.");
    }
  } catch (err) {
    return jsonResult(400, { detail: { error_type: "bad_request", message: err.message } });
  }
  try {
    const response = await api().decisions.create({ model: settings.model, input: request.input, questions: request.questions });
    return jsonResult(200, response);
  } catch (err) {
    const result = jsonResult(err.status || (err.name === "APIConnectionTimeoutError" ? 504 : 502), {
      detail: { error_type: "openai_decision_error", message: err.error?.message || err.message || "OpenAI decision failed." },
    });
    const retryAfter = err.headers?.get?.("retry-after");
    if (retryAfter) result.headers["Retry-After"] = retryAfter;
    return result;
  }
}
