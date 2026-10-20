import { test } from "node:test";
import assert from "node:assert/strict";
import { playerAvailable, resolveMatchup, prepareMatchup } from "../public/matchup.js";

const configured = {
  configured: true, gptConfigured: true, openaiConfigured: true, defaultOpponent: "openai",
};
const noFoundry = { ...configured, configured: false, gptConfigured: false };
const unexpected = () => assert.fail("Unexpected Foundry connection");

test("either side accepts every player, including mirror matches and legacy URLs", () => {
  for (const left of ["decision", "openai", "gpt", "heuristic", "haiku", "gemini", "laya"]) {
    for (const right of ["decision", "openai", "gpt", "heuristic", "haiku", "gemini", "laya"]) {
      assert.deepEqual(resolveMatchup(configured, new URLSearchParams({ left, right })), [left, right]);
    }
  }
  assert.deepEqual(resolveMatchup(configured), ["decision", "openai"]);
  assert.deepEqual(resolveMatchup(configured, new URLSearchParams("left=openai&opponent=haiku")), ["openai", "haiku"]);
  assert.deepEqual(resolveMatchup(configured, new URLSearchParams("right=gpt&opponent=haiku")), ["decision", "gpt"]);
});

test("unknown and unconfigured models fall back to available players on both sides", () => {
  assert.equal(playerAvailable("decision", noFoundry), false);
  assert.equal(playerAvailable("gpt", noFoundry), false);
  assert.equal(playerAvailable("openai", noFoundry), true);
  assert.deepEqual(resolveMatchup(noFoundry, new URLSearchParams("left=decision&right=gpt")), ["openai", "openai"]);
  assert.deepEqual(resolveMatchup({}, new URLSearchParams("left=__proto__&right=constructor")), ["heuristic", "heuristic"]);
});

test("OpenAI and local players start on either side without Azure configuration or sign-in", async () => {
  for (const ids of [["openai", "heuristic"], ["heuristic", "openai"], ["openai", "openai"]]) {
    const players = await prepareMatchup(ids, {}, { config: noFoundry, connect: unexpected });
    assert.equal(players.length, 2);
    assert.notEqual(players[0], players[1]);
    assert.equal(players[ids.indexOf("openai")].name, "OpenAI Decisions");
    assert.ok(players.every((player) => typeof player.decide === "function"));
  }
});

test("a Foundry player on either side requires one shared authentication check", async () => {
  for (const ids of [["openai", "decision"], ["gpt", "openai"], ["decision", "gpt"], ["gpt", "gpt"]]) {
    let connections = 0;
    await prepareMatchup(ids, {}, { config: configured, connect: async () => { connections++; } });
    assert.equal(connections, 1);
  }
  await assert.rejects(prepareMatchup(["openai", "gpt"], {}, {
    config: configured, connect: async () => { throw new Error("Sign-in failed"); },
  }), /Sign-in failed/);
});

test("both sides validate provider configuration and required keys before connecting", async () => {
  for (const [ids, message] of [
    [["haiku", "openai"], /Left model: enter the Anthropic key/],
    [["openai", "gemini"], /Right model: enter the Gemini key/],
    [["decision", "laya"], /Right model: enter the server address/],
  ]) {
    await assert.rejects(prepareMatchup(ids, {}, { config: configured, connect: unexpected }), message);
  }
  await assert.rejects(prepareMatchup(["decision", "openai"], {}, { config: noFoundry, connect: unexpected }), /Left model is not configured/);
  const players = await prepareMatchup(["haiku", "gemini"], { haiku: "test-key", gemini: "test-key" }, {
    config: {}, connect: unexpected,
  });
  assert.equal(players[0].short, "Haiku 4.5");
  assert.equal(players[1].short, "Gemini 3.8");
});

test("Laya's health check works on either side and is shared for mirror matches", async () => {
  for (const ids of [["laya", "openai"], ["openai", "laya"], ["laya", "laya"]]) {
    let checked = 0;
    const players = await prepareMatchup(ids, { laya: " http://localhost:8765 " }, {
      config: noFoundry, connect: unexpected,
      checkLaya: async (endpoint) => {
        assert.equal(endpoint, "http://localhost:8765");
        checked++;
        return { model: "custom-laya", runtime: "mlx" };
      },
    });
    assert.equal(checked, 1);
    assert.equal(players[ids.indexOf("laya")].endpoint, "http://localhost:8765");
    assert.equal(players[ids.indexOf("laya")].label, "custom-laya · mlx");
  }
});

test("loading the model menu permits missing Foundry while existing Foundry-only pages still reject it", async (t) => {
  globalThis.document = { querySelectorAll: () => [] };
  t.after(() => { delete globalThis.document; });
  t.mock.method(globalThis, "fetch", async () => Response.json({ ...noFoundry, message: "Foundry is not configured" }));
  const { loadFoundryConfig } = await import("../public/foundry.js?matchup-test");
  assert.equal((await loadFoundryConfig({ requireFoundry: false })).openaiConfigured, true);
  await assert.rejects(loadFoundryConfig(), /Foundry is not configured/);
  assert.equal((await loadFoundryConfig({ requireFoundry: false })).openaiConfigured, true);
});
