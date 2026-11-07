// pnpm seed [--reset] [--demo] [--placeholders]
// Loads seed/cases.json + seed/photos into Firestore/GCS (sandbox). See seed/README.md.
// Day 4 work; this stub only documents the contract so the command exists from Day 1.
try {
  process.loadEnvFile();
} catch {
  // .env is optional for the stub
}

const flags = new Set(process.argv.slice(2));
console.error(
  [
    "pnpm seed is not implemented yet (planned for Day 4).",
    `flags: ${[...flags].join(" ") || "(none)"}`,
    "Contract: --reset wipes this fund's collections + GCS prefix; --demo = reset + everything except C-001;",
    "--placeholders writes labeled gray images. Donations are never seeded (seed/README.md).",
  ].join("\n"),
);
process.exit(1);
