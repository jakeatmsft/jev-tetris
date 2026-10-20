import { test } from "node:test";
import assert from "node:assert/strict";
import { foundrySettings, forwardDecision, forwardGpt } from "../lib/foundry.mjs";
import { configResult } from "../lib/config.mjs";
import { forwardOpenaiDecision } from "../lib/openai-decisions.mjs";
import { emptyBoard, enumeratePlacements } from "../public/tetris.js";
import { buildGptRequest, parseGptChoice, buildOpenaiDecisionRequest, parseOpenaiDecisionChoice } from "../public/players.js";

const settings = foundrySettings({
  AZURE_AI_PROJECT_ENDPOINT: "https://example.services.ai.azure.com/api/projects/tetris",
  AZURE_OPENAI_BASE_URL: "https://example.openai.azure.com/openai/v1/",
  AZURE_DECISION_DEPLOYMENT: "Decision-1",
  AZURE_GPT_DEPLOYMENT: "my-gpt",
});

test("project endpoints resolve to the resource Decision API, independently of GPT", () => {
  assert.equal(settings.decisionURL, "https://example.services.ai.azure.com/providers/microsoft/v1/systemone");
  assert.equal(settings.responsesBaseURL, "https://example.openai.azure.com/openai/v1/");
  assert.equal(settings.scope, "https://cognitiveservices.azure.com/.default");
  assert.equal(foundrySettings({}).configured, false);
  assert.equal(foundrySettings({ AZURE_OPENAI_BASE_URL: "http://example.com" }).configured, false);
  const custom = foundrySettings({
    AZURE_OPENAI_BASE_URL: settings.responsesBaseURL,
    AZURE_DECISION_ENDPOINT: "https://example.services.ai.azure.com/custom/decision?api-version=preview",
  });
  assert.equal(custom.decisionURL, "https://example.services.ai.azure.com/custom/decision?api-version=preview");
});

test("the browser receives only the public configuration allowlist", () => {
  const result = configResult();
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.deepEqual(Object.keys(JSON.parse(result.body)).sort(), [
    "auth", "configured", "defaultOpponent", "gptConfigured", "gptModel", "openaiConfigured", "openaiModel", "message", "model", "provider", "serverKeyConfigured",
  ].sort());
});

test("OpenAI Decisions uses its own schema, keeps every move, and handles refusals", async () => {
  const board = emptyBoard();
  const placements = enumeratePlacements(board, "T");
  const request = buildOpenaiDecisionRequest({ board, piece: "T", nextPiece: "I", stats: placements[0].before, linesCleared: 0 }, placements);
  assert.deepEqual(request.questions[0].choices.map((c) => c.value), placements.map((p) => p.id));
  assert.equal(request.questions[0].name, "placement");
  assert.equal(JSON.parse(request.input).game.current_piece, "T");
  const reply = (type, choice) => ({ answers: [{ name: "placement", type, choice }] });
  assert.equal(parseOpenaiDecisionChoice(reply("choice", "p2"), placements), placements[2]);
  assert.equal(parseOpenaiDecisionChoice(reply("choice", "p999"), placements), null);
  assert.equal(parseOpenaiDecisionChoice(reply("refusal"), placements), null);
  const settings = { configured: true, model: "gpt-6-luna" };
  const result = await forwardOpenaiDecision({ settings, body: JSON.stringify({ ...request, model: "wrong", apiKey: "do-not-forward" }), api: () => ({ decisions: { create: async (body) => {
    assert.deepEqual(body, { ...request, model: "gpt-6-luna" });
    return reply("choice", "p2");
  } } }) });
  assert.equal(result.status, 200);
  assert.equal((await forwardOpenaiDecision({ settings: { configured: false }, body: "{}" })).status, 503);
  assert.equal((await forwardOpenaiDecision({ settings, body: "null" })).status, 400);
});

test("Decision proxy preserves typed questions and pins the server deployment", async () => {
  const request = { state: "board", model: "untrusted-model", questions: { placement: { type: "choice", criteria: { p0: "left", p1: "right" } } }, apiKey: "must-not-forward" };
  const answer = { answers: { placement: { type: "choice", choice: "p1" } } };
  const result = await forwardDecision({
    body: JSON.stringify(request), settings,
    api: () => ({ post: async (url, options) => {
      assert.equal(url, settings.decisionURL);
      assert.deepEqual(options.body, { state: request.state, questions: request.questions, model: "Decision-1" });
      return answer;
    } }),
  });
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), answer);
});

test("bad input and missing configuration never request a token or call a model", async () => {
  const api = () => assert.fail("Unexpected model call");
  for (const body of ["not JSON", "null", "{}", '{"state":"x","questions":[]}']) {
    assert.equal((await forwardDecision({ body, settings, api })).status, 400);
  }
  assert.equal((await forwardGpt({ body: "null", settings, api })).status, 400);
  assert.equal((await forwardDecision({ body: "{}", settings: foundrySettings({}), api })).status, 503);
});

test("rate limits and Retry-After reach the browser for decision backoff", async () => {
  const result = await forwardDecision({ body: '{"state":"board","questions":{}}', settings, api: () => ({ post: async () => {
    throw Object.assign(new Error("Rate limited"), { status: 429, headers: new Headers({ "retry-after": "2" }) });
  } }) });
  assert.equal(result.status, 429);
  assert.equal(result.headers["Retry-After"], "2");
});

test("GPT proxy uses Responses with the configured deployment and forced placement tool", async () => {
  const request = { model: "untrusted-model", input: "board", instructions: "Place a piece", tools: [], max_output_tokens: 999999, store: true };
  const result = await forwardGpt({ body: JSON.stringify(request), settings, api: () => ({ responses: { create: async (body) => {
    assert.equal(body.model, "my-gpt");
    assert.equal(body.input, request.input);
    assert.deepEqual(body.tool_choice, { type: "function", name: "place_piece" });
    assert.equal(body.max_output_tokens, 1024);
    assert.equal(body.store, false);
    assert.equal(body.parallel_tool_calls, false);
    return { output: [] };
  } } }) });
  assert.equal(result.status, 200);
});

test("GPT receives every legal move and invalid or malformed tool calls are rejected", () => {
  const board = emptyBoard();
  const placements = enumeratePlacements(board, "T");
  const request = buildGptRequest({ board, piece: "T", nextPiece: "I", stats: placements[0].before, linesCleared: 0 }, placements);
  assert.deepEqual(request.tools[0].parameters.properties.option_id.enum, placements.map((p) => p.id));
  assert.equal(request.tools[0].strict, true);
  const reply = (args) => ({ output: [{ type: "function_call", name: "place_piece", arguments: args }] });
  assert.equal(parseGptChoice(reply('{"option_id":"p3"}'), placements), placements[3]);
  assert.equal(parseGptChoice(reply('{"option_id":"p999"}'), placements), null);
  assert.equal(parseGptChoice(reply('{broken'), placements), null);
  assert.equal(parseGptChoice({ output: [{ type: "message", content: "p3" }] }, placements), null);
});
