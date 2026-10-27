// Only non-secret configuration is sent to the browser.
export const foundry = { configured: false, model: "Decision-1", gptModel: "", gptConfigured: false, openaiModel: "gpt-6-luna", openaiConfigured: false };
let configRequest;

export async function loadFoundryConfig({ requireFoundry = true } = {}) {
  const config = await (configRequest ??= (async () => {
    const response = await fetch("api/config", { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Could not load Foundry settings (HTTP ${response.status}).`);
    Object.assign(foundry, await response.json());
    for (const el of document.querySelectorAll("[data-decision-model]")) el.textContent = foundry.model;
    for (const el of document.querySelectorAll("[data-connection-status]")) {
      el.textContent = foundry.configured ? "Microsoft Entra ID · settings loaded" : foundry.message;
      el.classList.toggle("connection-error", !foundry.configured);
    }
    return foundry;
  })().catch((err) => {
    configRequest = null;
    throw err;
  }));
  if (requireFoundry && !config.configured) throw new Error(config.message);
  return config;
}

export async function ensureFoundryConnection() {
  await loadFoundryConfig();
  const response = await fetch("api/connection", { cache: "no-store", signal: AbortSignal.timeout(20000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail?.message || `Foundry authentication failed (HTTP ${response.status}).`);
  for (const el of document.querySelectorAll("[data-connection-status]")) el.textContent = "Microsoft Entra ID · signed in";
}
