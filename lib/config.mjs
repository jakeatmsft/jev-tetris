import { foundrySettings } from "./foundry.mjs";
import { openaiDecisionSettings } from "./openai-decisions.mjs";
import { jsonResult } from "./typesafe.mjs";

export function configResult(env = process.env) {
  const settings = foundrySettings(env);
  const openai = openaiDecisionSettings(env);
  // This is an explicit public allowlist. Never serialize process.env or tokens.
  return jsonResult(200, {
    provider: "foundry",
    auth: "entra",
    serverKeyConfigured: settings.configured,
    configured: settings.configured,
    model: settings.decisionDeployment,
    gptModel: settings.gptDeployment,
    gptConfigured: settings.configured && Boolean(settings.gptDeployment),
    openaiModel: openai.model,
    openaiConfigured: openai.configured,
    defaultOpponent: openai.configured ? "openai" : "heuristic",
    message: settings.error || "Microsoft Entra ID · server authentication",
  });
}
