// Real-time Tetris battle: two selected players on one seeded piece sequence
// and one clock. Each side runs its own loop (see arena.js): the model is asked
// when a piece spawns, gravity keeps pulling the piece down meanwhile, and a
// piece that lands before the answer arrives locks where it is. Gravity
// strengthens on a shared schedule. In versus mode cleared lines become
// garbage for the opponent and the first to top out loses; with independent
// boards the survivor must outlast the loser's piece count.

import { loadFoundryConfig, foundry } from "./foundry.js";
import { createMatchupControls } from "./matchup.js";
import {
  SPEEDUPS,
  PRESENT,
  STORAGE,
  sleep,
  formatClock,
  describeSpeedup,
  createRamp,
  makeSide,
  resetSide,
  previewSide,
  runModelSide,
  markTopOut,
  comparisonTable,
  judgeRound,
} from "./arena.js";

const $ = (id) => document.getElementById(id);
const ui = {
  haikuKey: $("haikuKey"),
  geminiKey: $("geminiKey"),
  layaEndpoint: $("layaEndpoint"),
  remember: $("remember"),
  gravity: $("gravity"),
  gravityLabel: $("gravityLabel"),
  speedup: $("speedup"),
  level: $("level"),
  seed: $("seed"),
  limit: $("limit"),
  lockstep: $("lockstep"),
  garbage: $("garbage"),
  start: $("start"),
  stop: $("stop"),
  clock: $("clock"),
  result: $("result"),
  error: $("error"),
  matchInfo: $("matchInfo"),
};

function sideEls(id) {
  return {
    canvas: $(`board${id}`),
    overlay: $(`overlay${id}`),
    incomingEl: $(`incoming${id}`),
    statsEl: $(`stats${id}`),
    moveEl: $(`move${id}`),
    section: $(id === "L" ? "left" : "right"),
  };
}

let sides = [];
let battle = null; // { ramp, abort, timer, limitMs, lockstep, garbage }
const matchup = createMatchupControls({ onChange: (players) => {
  if (!battle) {
    hideError();
    sides.forEach((side, index) => { side.player = players[index]; });
  }
} });

function gravityNow() {
  return battle ? battle.ramp.gravityNow() : Number(ui.gravity.value);
}

function renderLevel() {
  const level = battle ? battle.ramp.level() : 1;
  ui.level.textContent = `Level ${level} · ${gravityNow()} ms per row`;
  ui.level.classList.toggle("hot", level >= 4);
}

function showError(message) {
  ui.error.textContent = message;
  ui.error.classList.remove("hidden");
}

function hideError() {
  ui.error.classList.add("hidden");
}

function topOut(side) {
  markTopOut(side, battle ? battle.ramp.elapsed() : 0);
  checkEnd();
}

// ---- Battle control -----------------------------------------------------------------------

function checkEnd(timeUp = false) {
  if (!battle) return;
  const verdict = judgeRound(sides[0], sides[1], { garbage: battle.garbage, timeUp });
  if (verdict) finish(verdict.winner, verdict.loser, verdict.reason);
}

function finish(winner, loser, reason) {
  const [L, R] = sides;
  battle.abort.abort();
  clearInterval(battle.timer);
  const elapsed = battle.ramp.elapsed();
  if (winner) {
    winner.section.classList.add("winner");
    loser?.section.classList.add("loser");
  }
  const gravityNote =
    (battle.lockstep ? "lockstep, no gravity" : `gravity ${battle.ramp.gravityMs} → ${gravityNow()} ms/row, level ${battle.ramp.level()}`) +
    (battle.garbage ? ", versus" : "");
  ui.result.innerHTML = `${reason}<small>${formatClock(elapsed)} elapsed · seed ${ui.seed.value} · ${gravityNote}</small>${comparisonTable(L, R)}`;
  ui.result.classList.remove("hidden");
  ui.start.disabled = false;
  ui.stop.disabled = true;
  document.body.classList.remove("running");
  document.body.classList.add("played");
  battle = null;
  matchup.setDisabled(false);
}

async function startBattle() {
  hideError();
  ui.start.disabled = true;
  matchup.setDisabled(true);
  const startLabel = ui.start.textContent;
  ui.start.textContent = "Connecting…";
  let players;
  try {
    players = await matchup.prepare();
  } catch (err) {
    showError(err.message);
    ui.start.disabled = false;
    matchup.setDisabled(false);
    return;
  } finally {
    ui.start.textContent = startLabel;
  }
  persistKeys();
  const seed = Number(ui.seed.value) || 42;
  const gravityMs = Number(ui.gravity.value);
  const speedup = SPEEDUPS[ui.speedup.value] || SPEEDUPS.normal;
  const lockstep = ui.lockstep.checked;
  const garbage = ui.garbage.checked;
  const limitMs = Math.max(1, Number(ui.limit.value) || 5) * 60_000;
  sides = players.map((player, index) => {
    const id = index === 0 ? "L" : "R";
    return makeSide(id, player, sideEls(id));
  });
  sides[0].opponent = sides[1];
  sides[1].opponent = sides[0];
  for (const s of sides) resetSide(s, seed);
  ui.result.classList.add("hidden");
  ui.start.disabled = true;
  ui.stop.disabled = false;
  ui.matchInfo.textContent =
    (lockstep ? `seed ${seed} · lockstep, no gravity` : `seed ${seed} · ${gravityMs} ms per row, ${describeSpeedup(ui.speedup.value)}`) +
    (garbage ? " · cleared lines attack" : "");
  if (PRESENT) {
    document.body.classList.add("running");
    for (const n of [3, 2, 1]) {
      ui.clock.textContent = String(n);
      await sleep(800);
    }
  }
  const abort = new AbortController();
  battle = { ramp: createRamp({ gravityMs, speedup }), abort, timer: null, limitMs, lockstep, garbage };
  renderLevel();
  battle.timer = setInterval(() => {
    if (!battle) return;
    const elapsed = battle.ramp.elapsed();
    ui.clock.textContent = formatClock(elapsed);
    renderLevel();
    if (elapsed >= battle.limitMs) checkEnd(true);
  }, 250);
  const ctx = { signal: abort.signal, lockstep, gravityNow, garbage, onTopOut: topOut, onPiece: () => checkEnd(), showError };
  for (const s of sides) runModelSide(s, ctx);
}

function stopBattle() {
  if (!battle) return;
  checkEnd(true);
}

// ---- Keys and wiring -----------------------------------------------------------------------

function persistKeys() {
  try {
    if (ui.remember.checked) {
      localStorage.setItem(STORAGE.haiku, ui.haikuKey.value.trim());
      localStorage.setItem(STORAGE.gemini, ui.geminiKey.value.trim());
      localStorage.setItem(STORAGE.laya, ui.layaEndpoint.value.trim());
    } else {
      for (const k of Object.values(STORAGE)) localStorage.removeItem(k);
    }
  } catch {
    /* storage unavailable */
  }
}

ui.start.addEventListener("click", startBattle);
ui.stop.addEventListener("click", stopBattle);
ui.remember.addEventListener("change", persistKeys);
ui.gravity.addEventListener("input", () => {
  ui.gravityLabel.textContent = `${ui.gravity.value} ms per row`;
  if (!battle) renderLevel();
});
ui.gravityLabel.textContent = `${ui.gravity.value} ms per row`;
renderLevel();

try {
  const h = localStorage.getItem(STORAGE.haiku);
  const g = localStorage.getItem(STORAGE.gemini);
  const l = localStorage.getItem(STORAGE.laya);
  if (h) ui.haikuKey.value = h;
  if (g) ui.geminiKey.value = g;
  if (l) ui.layaEndpoint.value = l;
  if (h || g) ui.remember.checked = true;
} catch {
  /* storage unavailable */
}

matchup.render();
sides = matchup.choices().map((player, index) => {
  const id = index === 0 ? "L" : "R";
  return makeSide(id, player, sideEls(id));
});
for (const s of sides) previewSide(s, Number(ui.seed.value) || 42);

// Load safe server defaults before enabling the one-click start.
ui.start.disabled = true;
matchup.setDisabled(true);
try {
  matchup.configure(await loadFoundryConfig({ requireFoundry: false }));
} catch (err) {
  matchup.configure(foundry);
  showError(err.message);
} finally {
  ui.start.disabled = false;
  matchup.setDisabled(false);
}
