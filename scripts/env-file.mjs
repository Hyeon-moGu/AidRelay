// Reads a .env file the one way the deploy scripts do. cloudrun-env.mjs (what Cloud Run gets) and
// env-value.mjs (what schedule-sweep.sh sends) both use it, so they can never disagree about a value.
// A value runs to the end of the line, or to " #" when a comment follows; surrounding spaces and a
// Windows line ending are dropped; quotes are kept as written.
export function parseEnvFile(text) {
  const vars = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const hash = value.indexOf(" #");
    if (hash >= 0) value = value.slice(0, hash).trim();
    if (!value) continue;
    vars[key] = value;
  }
  return vars;
}
