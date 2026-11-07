// node scripts/cloudrun-env.mjs [APP_URL]
// Turns .env into deploy/env.yaml for `gcloud run deploy --env-vars-file`. Skips the key-file path
// (Cloud Run uses the attached service account) and lets the service URL override APP_URL.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const SKIP = new Set(["GOOGLE_APPLICATION_CREDENTIALS", "NEXT_PUBLIC_PAYPAL_CLIENT_ID"]);
const appUrl = process.argv[2];

const vars = {};
for (const raw of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq < 0) continue;
  const key = line.slice(0, eq).trim();
  let value = line.slice(eq + 1).trim();
  const hash = value.indexOf(" #");
  if (hash >= 0) value = value.slice(0, hash).trim();
  if (!value || SKIP.has(key)) continue;
  vars[key] = value;
}
if (appUrl) vars.APP_URL = appUrl.replace(/\/$/, "");
if (!vars.APP_URL || vars.APP_URL.includes("localhost")) {
  vars.APP_URL = vars.APP_URL ?? "http://localhost:3000";
  console.warn("APP_URL still points at localhost; rerun with the service URL after the first deploy.");
}

mkdirSync("deploy", { recursive: true });
const yaml = Object.entries(vars)
  .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
  .join("\n");
writeFileSync("deploy/env.yaml", yaml + "\n");
console.log(`deploy/env.yaml: ${Object.keys(vars).length} variables (${Object.keys(vars).join(", ")})`);
