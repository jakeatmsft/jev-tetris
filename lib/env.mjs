import dotenv from "dotenv";

// Load before any provider reads settings, including serverless entrypoints.
// Environment variables supplied by the host take precedence over the file.
dotenv.config({ path: new URL("../.env", import.meta.url), quiet: true });
