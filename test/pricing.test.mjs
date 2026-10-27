import { test } from "node:test";
import assert from "node:assert/strict";
import { createJevPlayer, createOpenaiDecisionPlayer } from "../public/players.js";
import { decisionCost, openaiDecisionCost, formatUsd } from "../public/pricing.js";
import { emptyBoard, enumeratePlacements } from "../public/tetris.js";

test("Decision-1 charges $0.042 per million input tokens and nothing for output", async (t) => {
  const board = emptyBoard();
  const placements = enumeratePlacements(board, "T");
  const game = { board, piece: "T", nextPiece: "I", stats: placements[0].before, linesCleared: 0 };
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, "api/decision");
    return Response.json({
      answers: { placement: { type: "choice", choice: placements[0].id, confidence: 0.9 } },
      usage: { input_tokens: 1_000_000, output_tokens: 3_000_000 },
    });
  });
  const move = await createJevPlayer().decide(game, placements);
  assert.equal(move.chosen, placements[0]);
  assert.equal(move.cost, 0.042);
  assert.equal(move.outputTokens, 3_000_000);
  assert.equal(decisionCost({ input_tokens: 0, output_tokens: 3_000_000 }), 0);
});

test("missing or invalid input usage stays unknown instead of reporting a free request", () => {
  for (const usage of [undefined, {}, { input_tokens: -1 }, { input_tokens: "500" }, { input_tokens: Infinity }]) {
    assert.equal(Number.isNaN(decisionCost(usage)), true);
    assert.equal(Number.isNaN(openaiDecisionCost(usage)), true);
  }
});

test("Foundry OpenAI Decisions estimates GPT-6 Luna input, cache reads, and cache writes", async (t) => {
  const board = emptyBoard();
  const placements = enumeratePlacements(board, "T");
  const game = { board, piece: "T", nextPiece: "I", stats: placements[0].before, linesCleared: 0 };
  let usage;
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, "api/openai-decision");
    return Response.json({
      answers: [{ name: "placement", type: "choice", choice: placements[0].id, confidence: 0.9 }],
      usage,
    });
  });
  const player = createOpenaiDecisionPlayer();
  for (const [reported, cost] of [
    [{ input_tokens: 1_000, output_tokens: 0 }, 0.0001],
    [{ input_tokens: 1_000_000, input_tokens_details: { cached_tokens: 1_000_000, cache_write_tokens: 0 } }, 0.01],
    [{ input_tokens: 1_000_000, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 1_000_000 } }, 0.125],
    [{ input_tokens: 1_000_000, input_tokens_details: { cached_tokens: 400_000, cache_write_tokens: 200_000 } }, 0.069],
    [{ input_tokens: 0, output_tokens: 1_000 }, 0],
    [undefined, NaN],
  ]) {
    usage = reported;
    const move = await player.decide(game, placements);
    assert.equal(move.chosen, placements[0]);
    assert.equal(move.inputTokens, usage?.input_tokens || 0);
    assert.equal(move.outputTokens, usage?.output_tokens || 0);
    assert.equal(move.cost, cost);
  }
});

test("invalid cache usage stays unknown instead of producing an incorrect cost", () => {
  for (const details of [
    { cached_tokens: -1 }, { cache_write_tokens: -1 },
    { cached_tokens: "500" }, { cache_write_tokens: Infinity },
    { cached_tokens: 0.5 }, { cache_write_tokens: 0.5 },
    { cached_tokens: 1_001 }, { cache_write_tokens: 1_001 },
    { cached_tokens: 600, cache_write_tokens: 500 },
  ]) {
    assert.equal(Number.isNaN(openaiDecisionCost({ input_tokens: 1_000, input_tokens_details: details })), true);
  }
});

test("small nonzero costs remain visible in totals and per-move estimates", () => {
  assert.equal(formatUsd(decisionCost({ input_tokens: 500 })), "$0.000021");
  assert.equal(formatUsd(decisionCost({ input_tokens: 1 })), "$0.00000004");
  assert.equal(formatUsd(decisionCost({ input_tokens: 1_000_000 })), "$0.0420");
  assert.equal(formatUsd(0), "$0.0000");
  assert.equal(formatUsd(NaN), "–");
});
