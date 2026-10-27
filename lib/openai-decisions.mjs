import { foundrySettings, getFoundryClient, foundryErrorResult } from "./foundry.mjs";
import { jsonResult } from "./typesafe.mjs";

export function openaiDecisionSettings(env = process.env) {
  const settings = foundrySettings(env);
  return {
    configured: settings.configured,
    error: settings.error,
    model: env.AZURE_OPENAI_DECISION_DEPLOYMENT?.trim() || "gpt-6-luna",
  };
}

export async function forwardOpenaiDecision({ body, settings = openaiDecisionSettings(), api = getFoundryClient }) {
  if (!settings.configured) return jsonResult(503, { detail: { message: settings.error } });
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
    return foundryErrorResult(err);
  }
}
