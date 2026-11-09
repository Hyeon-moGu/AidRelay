// The scheduled sweep signs its request with AGENT_INTERNAL_SECRET as scripts/env-value.mjs reads it (that is
// what scripts/schedule-sweep.sh sends); Cloud Run runs with the value scripts/cloudrun-env.mjs wrote into
// deploy/env.yaml. If the two read the same .env line differently, every scheduled sweep answers 401.
// Both readers run against throwaway .env files in a temp directory (never the real .env).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readers(envText: string): { scheduler: string | { exit: number; stderr: string }; cloudRun: string | undefined } {
  const dir = mkdtempSync(path.join(tmpdir(), "aidrelay-sched-"));
  try {
    writeFileSync(path.join(dir, ".env"), envText);
    let scheduler: string | { exit: number; stderr: string };
    try {
      scheduler = execFileSync("node", [path.join(ROOT, "scripts", "env-value.mjs"), "AGENT_INTERNAL_SECRET"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      const e = err as { status: number; stderr: string };
      scheduler = { exit: e.status, stderr: String(e.stderr) };
    }
    execFileSync("node", [path.join(ROOT, "scripts", "cloudrun-env.mjs"), "https://example.run.app"], { cwd: dir, stdio: "ignore" });
    const yaml = readFileSync(path.join(dir, "deploy", "env.yaml"), "utf8");
    const line = yaml.split("\n").find((l) => l.startsWith("AGENT_INTERNAL_SECRET: "));
    return { scheduler, cloudRun: line ? JSON.parse(line.slice("AGENT_INTERNAL_SECRET: ".length)) : undefined };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const S = "0123456789abcdef0123456789abcdef";

describe("the scheduler reads the same secret Cloud Run runs with", () => {
  it("plain line", () => {
    expect(readers(`AGENT_INTERNAL_SECRET=${S}\n`)).toEqual({ scheduler: S, cloudRun: S });
  });

  it("a .env saved with Windows line endings", () => {
    const r = readers(`APP_URL=http://localhost:3000\r\nAGENT_INTERNAL_SECRET=${S}\r\n`);
    expect(r.cloudRun).toBe(S);
    expect(r.scheduler).toBe(S);
  });

  it("an aligned inline comment", () => {
    const r = readers(`AGENT_INTERNAL_SECRET=${S}    # openssl rand -hex 16\n`);
    expect(r.cloudRun).toBe(S);
    expect(r.scheduler).toBe(S);
  });

  it("a quoted value", () => {
    const r = readers(`AGENT_INTERNAL_SECRET="${S}"\n`);
    expect(r.scheduler).toBe(r.cloudRun);
  });

  it("a missing secret stops with a message instead of an empty value", () => {
    const r = readers(`APP_URL=http://localhost:3000\n`);
    expect(r.scheduler).toMatchObject({ exit: 1, stderr: expect.stringContaining("AGENT_INTERNAL_SECRET is not set") });
  });

  it("the schedule script takes the secret from that reader", () => {
    const script = readFileSync(path.join(ROOT, "scripts", "schedule-sweep.sh"), "utf8");
    expect(script).toContain('SECRET="$(node scripts/env-value.mjs AGENT_INTERNAL_SECRET)"');
  });
});
