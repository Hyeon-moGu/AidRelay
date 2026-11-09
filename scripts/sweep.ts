// pnpm agent:sweep, runs the Case Officer over every case in status new | approved | parked.
try {
  process.loadEnvFile();
} catch {
  // rely on the environment when there is no .env
}

async function main() {
  const { runCaseOfficer } = await import("@/lib/agent/officer");
  const result = await runCaseOfficer({ trigger: "sweep" });
  console.log(result.runId ? `run ${result.runId}` : "no run recorded: nothing changed");
  console.log(result.summary);
  console.log(`tokens: in ${result.usage.inputTokens}, out ${result.usage.outputTokens}, model calls ${result.usage.modelCalls}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);

export {};
