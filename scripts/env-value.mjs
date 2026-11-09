// node scripts/env-value.mjs KEY
// Prints KEY's value from ./.env exactly as scripts/cloudrun-env.mjs reads it (no trailing newline).
// Exits 1 with a message when the key is missing or empty.
import { readFileSync } from "node:fs";
import { parseEnvFile } from "./env-file.mjs";

const key = process.argv[2];
if (!key) {
  console.error("usage: node scripts/env-value.mjs KEY");
  process.exit(2);
}
let text;
try {
  text = readFileSync(".env", "utf8");
} catch {
  console.error(".env not found in the current directory");
  process.exit(1);
}
const value = parseEnvFile(text)[key];
if (!value) {
  console.error(`${key} is not set in .env`);
  process.exit(1);
}
process.stdout.write(value);
