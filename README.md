# Model vs model Tetris

Choose the **Left player** and **Right player** independently on the battle and
presentation pages. Either side can use Decision-1, OpenAI Decisions on Foundry (`gpt-6-luna`),
Foundry GPT, Claude Haiku, Gemini, Laya, or the built-in heuristic. You can also run
the same model on both sides. Model names load from `.env`; Decision-1 versus OpenAI
Decisions remains the default when both are configured. Select the pair and click **Go**.
Both decision endpoints use Foundry and the server's Microsoft Entra identity;
optional provider keys use the existing fields.

For example, open **http://localhost:3000/?left=openai&right=gpt** to play OpenAI
Decisions against your configured Foundry GPT deployment. The same parameters work on
`present.html`. Player IDs are `decision`, `openai`, `gpt`, `heuristic`, `haiku`,
`gemini`, and `laya`. Existing `?opponent=...` links still select the right player.
Unavailable server-backed models are disabled in both selectors. Each selected provider's
key field is shown, and the model choices stay fixed until the match or series ends.
Matches without a Foundry player do not require Azure configuration or Entra sign-in.

## Start locally

From the repository folder, run the commands below.

Requires Node.js 22 or later. Foundry players also require an identity with inference
access to your Foundry resource.

```sh
npm install
# If .env does not already exist, copy .env.example to .env and set your endpoints.
az login # Only needed when selecting a Foundry player.
npm start
```

These commands work in both WSL and PowerShell. Open **http://localhost:3000**;
the legacy `/battle.html` URL also opens the home page.
The existing `.env` is loaded automatically. Host
process variables override file values. Restart the server after changing `.env`.

| Setting | Purpose |
| --- | --- |
| `AZURE_OPENAI_BASE_URL` | Foundry base URL for OpenAI Decisions and GPT Responses, e.g. `https://RESOURCE.openai.azure.com/openai/v1`. |
| `AZURE_AI_PROJECT_ENDPOINT` | Existing Foundry project URL; its origin is a fallback when no Decision resource URL is set. |
| `AZURE_AI_RESOURCE_ENDPOINT` | Recommended Decision-1 resource URL from the account's `properties.endpoint`, e.g. `https://RESOURCE.cognitiveservices.azure.com`; takes precedence over the project URL. |
| `AZURE_DECISION_DEPLOYMENT` | Decision deployment name; defaults to `Decision-1`. |
| `AZURE_GPT_DEPLOYMENT` | Optional Foundry GPT Responses opponent deployment name. |
| `AZURE_OPENAI_DECISION_DEPLOYMENT` | Foundry deployment name for OpenAI Decisions; defaults to `gpt-6-luna`. Must deploy the `gpt-6-luna` model. |
| `AZURE_TOKEN_SCOPE` | Defaults to `https://cognitiveservices.azure.com/.default`. |
| `AZURE_DECISION_ENDPOINT` | Optional complete Decision API URL override, including any required query parameters. |
| `GPT_REASONING_EFFORT` | Defaults to `none`; use an effort supported by your GPT deployment. |
| `GPT_MAX_OUTPUT_TOKENS` | Defaults to `1024`. |
| `PORT` | Defaults to `3000`. |

The server uses `DefaultAzureCredential` and refreshed Entra bearer tokens, with
one shared OpenAI JavaScript client for both decision endpoints and GPT Responses.
No OpenAI API key is required or used. For a Foundry service principal, set `AZURE_TENANT_ID`,
`AZURE_CLIENT_ID`, and `AZURE_CLIENT_SECRET`. On Azure, a managed identity can supply
the credentials instead. Keep secrets in the ignored `.env`, never in `public/`.

Microsoft's [Decision-1 documentation](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/use-foundry-models-microsoft-decision)
specifies `/providers/microsoft/v1/systemone` on the Foundry resource. This app uses
that route with `{model, state, questions}`. `AZURE_DECISION_ENDPOINT` can override
the complete URL for a compatible gateway.
Set `AZURE_AI_RESOURCE_ENDPOINT` to the account endpoint returned by
`az cognitiveservices account show --name RESOURCE --resource-group GROUP --query properties.endpoint --output tsv`.
Using the project's `services.ai.azure.com` host for Decision-1 can produce
"Unable to get resource information" errors or timeouts; the account's
`cognitiveservices.azure.com` endpoint resolves that routing issue.

[Azure OpenAI Decisions](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/decisions?tabs=javascript) uses
`POST https://RESOURCE.openai.azure.com/openai/v1/decisions` via `client.decisions.create()`.
The server pins `model` to `AZURE_OPENAI_DECISION_DEPLOYMENT`, the deployment name from
Foundry. Its
`input`, named `questions` array and `choices` array are built from the same board
and placements used by Decision-1. Refusals and invalid choices are reported as
invalid decisions. Requests use the same refreshed Entra token as Decision-1.
Existing `OPENAI_API_KEY` and `OPENAI_DECISION_MODEL` settings are ignored; use the
Azure endpoint and deployment settings above.

The optional Foundry GPT opponent uses `/openai/v1/responses` with a forced, strict
`place_piece` function call. When Foundry is configured, the default matchup is
Decision-1 versus OpenAI Decisions on Foundry. Without Foundry configuration, the
landing page selects the local heuristic.

The **Check connection** action verifies Entra sign-in; deployment access is verified
when a model request runs. A 401/403 means sign-in or role access needs attention;
404 means the endpoint or deployment should be checked.

**Decision-1 input tokens cost $0.042 USD per million tokens; output tokens are free.**
The [published rate](https://commandline.microsoft.com/microsoft-decision-1-model-foundry/)
appears beneath Decision-1's model name on either side. Battle, presentation, human-play,
and solo costs use the reported input-token usage at that base rate. Small nonzero costs
remain visible instead of rounding to zero. Missing usage displays `–`.

**Foundry Decisions pricing (USD per 1M tokens):**

| Decision API supported model | Input | Output | Cached input | 30-minute cached write |
| --- | --- | --- | --- | --- |
| GPT-6 Luna | $0.10 | N/A | $0.01 | $0.125 |

These rates appear beneath OpenAI Decisions' model name on either side. Its cost
estimates use reported input usage, charging cached reads and 30-minute cache writes
at their respective rates without counting them again as regular input. When cache
details are absent, all reported input is estimated at the regular input rate.
Foundry GPT costs still display `–` because its Azure deployment rates are not
configured. Token usage and latency are still reported for all models.

The human-versus-model and solo pages use Decision-1 with the same server credentials.
The presentation page uses the two selected models throughout the series, including
its board labels, round winners, and totals. The gameplay notes and historical Jev benchmark results
below describe the original application; those measurements are not Decision-1 results.

## The battle

Each side runs its own real-time game loop on a seeded piece sequence shared by both players.

- **Decisions under a falling piece.** When a piece spawns, the model is asked at once. Meanwhile
  gravity pulls the piece down one row every N ms. When the answer arrives, the piece slides to the
  chosen column and rotation and hard-drops. If it lands before the answer arrives, it locks where it
  is: a missed deadline.
- **Gravity rises over time** on a schedule both sides share. Default: 150 ms per row, 15% faster
  every 20 seconds, floor 40 ms. The level shows under the clock. Gentle, brutal and constant
  schedules are selectable.
- **Versus.** Every cleared line becomes a garbage row (full except one gap) queued for the opponent
  and inserted under their stack when their current piece locks. A red counter shows incoming rows.
  If the push shoves the stack out of the top, that player is out, and the first to top out loses.
- **Same information for both.** Code enumerates every legal placement and describes each outcome in
  words (lines cleared, holes created, height, surface, wells). Jev answers with a Choice question
  over those options; the opponent (Claude Haiku 4.5 via the Anthropic API, or Gemini 3.8 Flash via
  the Gemini API) answers through a forced `place_piece` function call whose `option_id` is an enum
  of the same options. Laya, whose context is only 512 tokens, gets a one-paragraph description of
  the board and the six best placements pre-ranked by the code's heuristic, and picks one with the
  same Choice question shape. All are constrained to legal moves; latency is part of the game. Pick
  the opponent in the setup card or with `?opponent=gemini` / `?opponent=laya`.
- **Stats per model.** Lines, pieces, garbage sent and received, average and min/max latency, missed
  deadlines, invalid answers, model calls, tokens in and out, cost and cost per move, live under each
  board and in a side-by-side table when the match ends.

Untick the versus box and the boards become independent; since a faster player cycles through more
pieces per minute, the survivor then has to outlast the loser's piece count to win. The "wait for
answers" toggle removes gravity so only decision quality is compared. Append `?present` to the URL
for a stripped-down layout meant for recordings.

### Recording a series: the presentation page

[`present.html`](public/present.html) is the layout for videos: boards as tall as the window, a
best-of-N score in the middle, the round clock, the round result and a round-by-round list, and
nothing else once the series starts. Every round draws a fresh random seed that both sides share.
Rounds follow each other after a pause you set (0 waits for you), and the series ends when one side
has a majority, with a totals table for the whole series.

![Presentation page, best of 3](docs/present.png)

Open [jev-tetris.vercel.app/present.html](https://jev-tetris.vercel.app/present.html) (or
`http://localhost:3000/present.html`), fill in the setup card, size the window to 1280 × 720 or
1920 × 1080, start your screen recorder and press **Start series**. Keys while it runs: Space starts
the next round now, Esc ends the round (twice to end the series), N opens the setup for a new series.
`?opponent=laya&rounds=5&hold=8&gravity=150&speedup=normal&seed=42` pre-fills the form; `seed`
switches to reproducible seeds (seed, seed+1, …) instead of random ones.

### Results so far

Seed 42, one run each. Jev is not fully deterministic between runs, so treat these as samples.

**Jev vs Laya**

![Jev vs Laya, versus mode](docs/battle-laya.png)

| Mode | Result | Jev | Laya (`convaiinnovations/laya`, PyTorch on a 4-core CPU) |
| --- | --- | --- | --- |
| Versus, gravity 150 ms/row rising 15% every 20 s | Jev wins at 0:14: Laya topped out first | 7 lines, 27 pieces, sent 7 garbage, 232 ms/move, 0 missed, $0.0035 | 0 lines, 19 pieces, 614 ms/move, 2 missed, $0 |
| Lockstep (no gravity), Laya alone | topped out after 53 pieces | | 5 lines, picked the heuristic's top option 16 times out of 53 |

Laya is a 421M-parameter ModernBERT encoder trained on typed decisions in other domains (email
triage, routing), not Tetris, and it shows: its
probabilities over the six candidates are nearly flat (entropy confidence 0.01 to 0.1), it prefers
whichever options are listed first, and it does not favor the "clears four lines" option even when it
is the only one that clears anything. Given unlimited time it lasts about 50 pieces; in real time,
Jev's garbage plus a 0.4 to 0.6 s think time on this CPU end it in seconds. On Apple Silicon with
[laya-mlx](https://github.com/mizorewww/laya-mlx) the same model answers in tens of milliseconds, which
removes the latency handicap but not the decision quality.

**Jev vs Gemini 3.8 Flash**

![Jev vs Gemini 3.8 Flash, versus mode](docs/battle-gemini.png)

| Mode | Result | Jev | Gemini 3.8 Flash |
| --- | --- | --- | --- |
| Versus, gravity 150 ms/row rising 15% every 20 s | Jev wins at 0:18: Gemini topped out first | 6 lines, 35 pieces, sent 6 garbage, 212 ms/move, 0 missed, $0.005 | 0 lines, 13 pieces, 1346 ms/move, 8 missed, $0.008 |
| Lockstep (no gravity), independent boards | Gemini wins: survived past Jev's 105 pieces | 26 lines, 105 pieces, 205 ms/move, $0.014 | 34 lines, 106 pieces, 1881 ms/move (up to 6.3 s), 11 invalid, $0.231 |

Gemini 3.8 Flash cannot switch thinking off (its lowest level still spends a few dozen thinking tokens
per move), so it answers in 0.7 to 2 s and in real time it misses most deadlines. Given unlimited time
it places pieces better than Jev on this seed (0.32 lines per piece against 0.25) at about 17x the cost
per move.

**Jev vs Claude Haiku 4.5**

| Mode | Result | Jev | Claude Haiku 4.5 |
| --- | --- | --- | --- |
| Versus, gravity 150 ms/row rising 15% every 20 s | Jev wins at 0:17: Haiku topped out first | 10 lines, 34 pieces, sent 10 garbage, 216 ms/move, 0 missed, $0.004 | 4 lines, 21 pieces, sent 4 garbage, 700 ms/move, 2 missed, $0.053 |
| Independent boards, same gravity | Jev wins: out at 97 pieces, Haiku out at 61 | 25 lines, 243 ms/move, 2 missed, $0.013 | 15 lines, 721 ms/move, 6 missed, $0.155 |
| Lockstep (no gravity) | Jev wins, survived more pieces | 52 lines, 167 pieces, 219 ms/move, $0.022 | 28 lines, 106 pieces, 832 ms/move, $0.301 |

Jev answers in about 220 ms and Haiku in about 750 ms, so Jev clears lines roughly twice as fast in
wall-clock terms. In versus mode that gap turns into garbage: Haiku's board fills from below faster
than it can clear from above. Missed deadlines bite both sides as the stack rises, because near the
top a piece has only a few rows to fall. Per move, Jev costs about 20x less: its input tokens are
cheap and its output is free, while Haiku bills both directions.

## Laya, the open-weight opponent

[Laya](https://github.com/NandhaKishorM/laya) exposes the same `system_one(state, questions)` call as
TypeSafe's API, so it drops in as a battle opponent, running on your machine rather than behind a key.
`tools/laya_server.py` wraps it in a small HTTP server with the TypeSafe request shape and open CORS:

```sh
pip install laya-mlx        # Apple Silicon (MLX port of the open weights), or
pip install laya            # PyTorch reference build, any platform (CPU works, ~0.35 s per move on 4 cores)
python tools/laya_server.py # loads the checkpoint, listens on http://localhost:8765
```

Then open the battle page, choose **Laya (local, open weights)** as the opponent and start. The page
calls `http://localhost:8765` straight from the browser, so it works from the hosted copy too (browsers
allow https pages to reach localhost). `--model` picks another checkpoint, `--runtime torch|mlx`
forces a runtime, `--verbose` logs every move with its inference time.

What Laya sees is built by `buildLayaRequest` in `public/players.js`: a text summary of the board
("The stack is low and slightly uneven with one hole. Column 10 is a deep well. The falling piece is
an I bar. Next piece: T.") and six options such as `column 10 vertical: clears four lines, no holes,
stack gets lower`, ordered best-first by the heuristic. Laya returns a probability per option and the
page plays its top pick.

## Play against Jev yourself

[jev-tetris.vercel.app/play.html](https://jev-tetris.vercel.app/play.html) puts you on the left
and Jev on the right with the same versus rules: shared piece sequence, rising gravity, cleared
lines become garbage for the other side, first to top out loses. Arrow keys move, up or X rotates,
Z rotates back, down soft-drops, space hard-drops; on touch screens a button row appears under the
board. You get a ghost piece and a short lock delay. Gravity starts gentler than in the model battle
(500 ms per row, 10% faster every 30 s) and is adjustable. This checkout uses the Foundry Entra credentials from `.env`.

## Single player: Jev on its own

[jev-tetris.vercel.app/solo.html](https://jev-tetris.vercel.app/solo.html) shows one Jev game with
every decision explained: the chosen placement with confidence, the alternatives with their probabilities drawn as
ghost outlines on the board, Jev's read of the board (strategy, health, whether the next piece has a
clean spot), token usage, cost, and the raw request and response.

![Jev plays Tetris](docs/screenshot.png)

Jev is not a text generator or a planner. It answers typed questions about a piece of state and
returns calibrated probabilities, so the split of work follows TypeSafe's
[building guide](https://docs.typesafe.ai/concepts/how-to-build-with-system-one): code owns the
game, Jev supplies the judgment.

1. **Code enumerates every legal placement**, simulates it, and computes the outcome. See
   [`public/tetris.js`](public/tetris.js).
2. **Code turns the numbers into words.** Jev reads text and is weak at arithmetic
   ([jaggedness notes](https://docs.typesafe.ai/model-jaggedness/jev-1.13)), so each placement becomes
   a small object with the same fields on every option: `lines_cleared: "two lines"`,
   `holes_created: "none"`, `stack_height_after: "low"`, `surface_after: "flat"`, and so on.
3. **One request to `POST /v1/systemone`** carries the board as state plus four questions
   ([speculative fan-out](https://docs.typesafe.ai/patterns/fan-out)). See [`public/jev.js`](public/jev.js).

   | Question | Type | What it does |
   | --- | --- | --- |
   | `placement` | Choice over every placement | Drives the game. The chosen option is dropped. |
   | `strategy` | Choice (`build_clean`, `clear_lines`, `repair_surface`, `survive`) | Shown as Jev's game plan. |
   | `board_health` | Score over four levels | Shown as a gauge. |
   | `next_piece_fits` | Noul | Shown as a probability bar. |

4. **Code acts on the answer.** The chosen placement is animated and locked. A classic hand-tuned
   heuristic runs alongside, and the panel shows how often Jev agrees with it.

Each move is one request of roughly 2,500 to 4,000 input tokens. A 150-piece game measured about
240 ms per move and roughly 530k input tokens, about two cents at the published price. Observed play:
50 lines over 150 pieces without topping out, 69% agreement with the heuristic. Jev takes single-line
clears readily and tolerates holes more than the heuristic does; the `priorities` list in
`public/jev.js` is where to push it toward cleaner play. No key? Switch to the built-in heuristic to
watch the code-only player.

## Hosting

The same Foundry handlers run locally and as Vercel functions in `api/`. Configure
the environment variables on your host and supply an Entra service principal or a
supported managed identity. Azure CLI sign-in is for local development. Install
dependencies before running the server (`npm install`).

The server exposes `/api/decision`, `/api/openai-decision`, `/api/gpt`, `/api/config` (public settings only),
and `/api/connection` (checks Entra authentication). `/api/systemone` and `/api/models`
remain compatibility aliases. Optional Anthropic, Gemini and local Laya opponents
remain available in the opponent menu.

## Tests

```sh
npm test
```

Unit tests cover the engine (placement enumeration, line clears, hole counting, garbage rows, seeded
piece sequences) and the request builders (one criteria entry per placement, stable field names,
answer mapping, the Haiku tool schema and reply parser).

## Files

```
server.mjs            local static server + proxies
lib/foundry.mjs       Entra authentication and Foundry Decision/GPT proxies
lib/openai-decisions.mjs  Azure OpenAI Decisions proxy using shared Foundry authentication
lib/config.mjs        public configuration allowlist
lib/typesafe.mjs      shared HTTP helpers and legacy TypeSafe utilities
lib/anthropic.mjs     Anthropic Messages API proxy for the battle
lib/gemini.mjs        Gemini generateContent proxy for the battle
api/*.js              the same proxies as Vercel serverless functions
vercel.json           Vercel config (static public/, functions in api/)
public/index.html     battle page (+ battle.css, battle.js)
public/play.html      human vs Jev (+ play.js)
public/arena.js       shared two-board machinery: sides, drawing, stats, garbage, gravity ramp, model loop
public/players.js     Jev, Claude Haiku, Gemini and Laya players for the battle
tools/laya_server.py  local HTTP wrapper around Laya (laya-mlx or laya) with the TypeSafe request shape
public/solo.html      single-player page (+ style.css, app.js)
public/battle.html    redirect to the front page for old links
public/tetris.js      pure engine: pieces, placements, outcome descriptions, garbage, seeded RNG
public/jev.js         Jev request builder, API call with retry, answer mapping
test/tetris.test.mjs  node --test suite
```

## Tuning

Everything Jev sees is in `buildState` and `buildQuestions` in [`public/jev.js`](public/jev.js);
the Haiku and Gemini prompts and tools, and Laya's board summary, are in [`public/players.js`](public/players.js). The `priorities`
list inside Jev's `placement` question is where to change how it weighs line clears against holes
and height. The word buckets for each feature live in the `describe*` helpers in
[`public/tetris.js`](public/tetris.js). Keep the numbers in code and hand the models the comparison.
