// Vercel serverless function: GET /api/config
import { configResult } from "../lib/config.mjs";
import { writeResult } from "../lib/typesafe.mjs";

export default function handler(req, res) {
  writeResult(res, configResult());
}
