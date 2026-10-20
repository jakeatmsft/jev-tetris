import { test } from "node:test";
import assert from "node:assert/strict";
import { createJevPlayer } from "../public/players.js";
import { decisionCost, formatUsd } from "../public/pricing.js";
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
  }
});

test("small nonzero costs remain visible in totals and per-move estimates", () => {
  assert.equal(formatUsd(decisionCost({ input_tokens: 500 })), "$0.000021");
  assert.equal(formatUsd(decisionCost({ input_tokens: 1 })), "$0.00000004");
  assert.equal(formatUsd(decisionCost({ input_tokens: 1_000_000 })), "$0.0420");
  assert.equal(formatUsd(0), "$0.0000");
  assert.equal(formatUsd(NaN), "–");
});
