import { forwardGpt } from "../lib/foundry.mjs";
import { jsonResult, readJsonBody, writeResult } from "../lib/typesafe.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") return writeResult(res, jsonResult(405, { detail: { message: "Use POST." } }));
  writeResult(res, await forwardGpt({ body: await readJsonBody(req) }));
}
