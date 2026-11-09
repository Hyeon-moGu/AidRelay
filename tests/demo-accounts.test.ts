// The sandbox donor account shown on /donate is the one the README publishes for judges.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SANDBOX_DONOR } from "@/lib/demo-accounts";

describe("the sandbox donor account on /donate", () => {
  it("matches the Donor row of the README's test accounts", () => {
    const readme = readFileSync(path.join(process.cwd(), "README.md"), "utf8");
    const row = readme.split("\n").find((line) => line.startsWith("| Donor |"));
    expect(row).toBeDefined();
    expect(row).toContain(`\`${SANDBOX_DONOR.email}\``);
    expect(row).toContain(`\`${SANDBOX_DONOR.password}\``);
  });

  it("is a PayPal sandbox account, never a real one", () => {
    expect(SANDBOX_DONOR.email).toMatch(/@personal\.example\.com$/);
  });
});
