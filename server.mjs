// Static app and server-side Foundry proxies. Credentials stay on the server.
import "./lib/env.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  jsonResult,
  readJsonBody,
  validateJson,
  writeResult,
} from "./lib/typesafe.mjs";
import { configResult } from "./lib/config.mjs";
import { forwardOpenaiDecision } from "./lib/openai-decisions.mjs";
import { foundrySettings, forwardDecision, forwardGpt, connectionResult } from "./lib/foundry.mjs";
import { forwardToAnthropic } from "./lib/anthropic.mjs";
import { forwardToGemini } from "./lib/gemini.mjs";

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function serveStatic(res, urlPath) {
  let filePath = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  if (filePath === "/" || filePath === "") filePath = "/index.html";
  const full = join(PUBLIC_DIR, filePath);
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const info = await stat(full);
    if (!info.isFile()) throw new Error("not a file");
    const data = await readFile(full);
    res.writeHead(200, {
      "Content-Type": MIME[extname(full)] || "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (["/api/decision", "/api/systemone", "/api/gpt", "/api/openai-decision"].includes(url.pathname) && req.method === "POST") {
      const body = await readJsonBody(req);
      const forward = url.pathname === "/api/openai-decision" ? forwardOpenaiDecision : url.pathname === "/api/gpt" ? forwardGpt : forwardDecision;
      writeResult(res, await forward({ body }));
      return;
    }
    if (["/api/connection", "/api/models"].includes(url.pathname) && req.method === "GET") {
      writeResult(res, await connectionResult());
      return;
    }
    if (url.pathname === "/api/anthropic" && req.method === "POST") {
      const body = await readJsonBody(req);
      const invalid = validateJson(body);
      if (invalid) {
        writeResult(res, invalid);
        return;
      }
      writeResult(res, await forwardToAnthropic({ key: req.headers["x-api-key"] || "", body }));
      return;
    }
    if (url.pathname === "/api/gemini" && req.method === "POST") {
      const body = await readJsonBody(req);
      writeResult(res, await forwardToGemini({ key: req.headers["x-goog-api-key"] || "", body }));
      return;
    }
    if (url.pathname === "/api/config" && req.method === "GET") {
      writeResult(res, configResult());
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      writeResult(res, jsonResult(404, { detail: { error_type: "not_found", message: "Unknown API route." } }));
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    await serveStatic(res, url.pathname);
  } catch (err) {
    writeResult(res, jsonResult(500, { detail: { error_type: "server_error", message: err.message } }));
  }
});

server.listen(PORT, () => {
  console.log(`jev-tetris listening on http://localhost:${PORT}`);
  const settings = foundrySettings();
  console.log(settings.configured ? `Foundry ${settings.decisionDeployment} · Microsoft Entra ID` : settings.error);
});
