// Shared model selection for the battle and presentation pages.
import { PLAYERS, configureFoundryPlayers, checkLayaServer } from "./players.js";
import { foundry, ensureFoundryConnection } from "./foundry.js";
import { formatPricing } from "./pricing.js";

export function playerAvailable(id, config) {
  if (!Object.hasOwn(PLAYERS, id)) return false;
  if (id === "decision") return Boolean(config.configured);
  if (id === "gpt") return Boolean(config.gptConfigured);
  if (id === "openai") return Boolean(config.openaiConfigured);
  return true;
}

export function resolveMatchup(config, params = new URLSearchParams()) {
  const fallback = ["decision", "openai", "gpt", "heuristic"].find((id) => playerAvailable(id, config));
  const choose = (requested, defaultId) => playerAvailable(requested, config) ? requested : defaultId;
  const rightDefault = choose(config.defaultOpponent, "heuristic");
  return [
    choose(params.get("left"), fallback),
    choose(params.get("right") ?? params.get("opponent"), rightDefault),
  ];
}

export async function prepareMatchup(ids, credentials = {}, {
  config = foundry,
  connect = ensureFoundryConnection,
  checkLaya = checkLayaServer,
} = {}) {
  if (ids.length !== 2) throw new Error("Choose a model for each side.");
  const players = ids.map((id, index) => {
    const side = index === 0 ? "Left" : "Right";
    if (!playerAvailable(id, config)) throw new Error(`${side} model is not configured. Choose an available model or update .env and restart the server.`);
    const player = PLAYERS[id];
    if (player.requiresKey !== false && !credentials[id]?.trim()) {
      throw new Error(`${side} model: enter the ${player.keyName} ${id === "laya" ? "" : "key "}for ${player.name}.`);
    }
    return player;
  });
  // All Foundry models share the server's Entra authentication check.
  if (ids.some((id) => ["decision", "openai", "gpt"].includes(id))) await connect();
  const layaInfo = ids.includes("laya") ? await checkLaya(credentials.laya.trim()) : null;
  return players.map((player, index) => ({
    ...player.create(credentials[ids[index]]?.trim() || ""),
    name: player.name,
    short: player.short,
    badge: player.badge,
    label: ids[index] === "laya" && layaInfo
      ? `${layaInfo.model || "laya"} · ${layaInfo.runtime || "local"}` : player.label,
  }));
}

export function createMatchupControls({ onChange = () => {}, titleSuffix = "" } = {}) {
  const $ = (id) => document.getElementById(id);
  const selectors = [$("playerL"), $("playerR")];
  const ids = () => selectors.map((select) => select.value);
  const choices = () => ids().map((id) => PLAYERS[id]);
  const credentials = () => ({
    haiku: $("haikuKey").value,
    gemini: $("geminiKey").value,
    laya: $("layaEndpoint").value,
  });

  function render() {
    const selected = ids();
    choices().forEach((player, index) => {
      const side = index === 0 ? "L" : "R";
      $(`badge${side}`).textContent = player.name;
      $(`badge${side}`).className = `badge ${player.badge}`;
      $(`model${side}`).textContent = player.label;
      const price = $(`price${side}`);
      price.classList.toggle("hidden", !player.pricing);
      price.textContent = player.pricing ? formatPricing(player.pricing) : "";
      if (player.pricing) price.href = player.pricing.source;
      else price.removeAttribute("href");
      if ($(`name${side}`)) $(`name${side}`).textContent = player.short;
      $(`board${side}`).setAttribute("aria-label", `${index === 0 ? "Left" : "Right"} board: ${player.name}`);
    });
    const title = choices().map((player) => player.name).join(" vs ");
    document.title = title + titleSuffix;
    if ($("matchTitle")) $("matchTitle").textContent = title;
    $("haikuKeyField").classList.toggle("hidden", !selected.includes("haiku"));
    $("geminiKeyField").classList.toggle("hidden", !selected.includes("gemini"));
    $("layaField").classList.toggle("hidden", !selected.includes("laya"));
    $("layaNote")?.classList.toggle("hidden", !selected.includes("laya"));
    $("remember").closest("label").classList.toggle("hidden", !selected.some((id) => ["haiku", "gemini", "laya"].includes(id)));
    for (const el of document.querySelectorAll("[data-connection-status]")) {
      el.textContent = selected.some((id) => ["decision", "openai", "gpt"].includes(id))
        ? "Selected Foundry models use the server’s Microsoft Entra ID sign-in."
        : "No Foundry connection required for this match.";
      el.classList.remove("connection-error");
    }
  }

  function configure(config, params = new URLSearchParams(location.search)) {
    configureFoundryPlayers(config);
    const selection = resolveMatchup(config, params);
    const labels = {
      decision: "Foundry", openai: `${config.openaiModel || "gpt-6-luna"} · Foundry`, gpt: "ResponsesAPI",
      heuristic: "local", haiku: "Anthropic", gemini: "Google", laya: "local",
    };
    selectors.forEach((select, index) => {
      select.replaceChildren(...Object.entries(PLAYERS).map(([id, player]) => {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = `${player.name} (${labels[id]})`;
        option.disabled = !playerAvailable(id, config);
        return option;
      }));
      select.value = selection[index];
    });
    render();
    onChange(choices());
  }

  function setDisabled(disabled) {
    for (const el of [...selectors, $("haikuKey"), $("geminiKey"), $("layaEndpoint")]) el.disabled = disabled;
  }

  for (const select of selectors) select.addEventListener("change", () => {
    render();
    onChange(choices());
  });
  async function prepare() {
    const players = await prepareMatchup(ids(), credentials());
    players.forEach((player, index) => {
      $(`model${index === 0 ? "L" : "R"}`).textContent = player.label;
    });
    return players;
  }

  return { choices, render, configure, setDisabled, prepare };
}
