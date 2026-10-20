import { connectionResult } from "../lib/foundry.mjs";
import { jsonResult, writeResult } from "../lib/typesafe.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") return writeResult(res, jsonResult(405, { detail: { message: "Use GET." } }));
  writeResult(res, await connectionResult());
}
