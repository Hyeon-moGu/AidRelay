// Independent review of c3abf86 (scrubIdentity). Property/fuzz checks: never throws, bounded time on hostile
// input, a full name or the street line given in the contact never survives, ordinary text is left alone;
// plus the seeded addresses the demo actually uses.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scrubIdentity } from "@/lib/ledger/anonymize";

const seed = JSON.parse(readFileSync(path.join(process.cwd(), "seed", "cases.json"), "utf8")) as {
  cases: Array<{ id: string; contact: { name: string; address: string | null } }>;
  bulk: { streets: string[]; names: { en: string[]; es: string[] } };
};

/** Deterministic PRNG so a failure is reproducible. */
function rng(seedN: number) {
  let s = seedN >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const META = ".*+?^${}()|[]\\/-'&";
function randomWord(r: () => number, alphabet: string): string {
  const n = 1 + Math.floor(r() * 8);
  return Array.from({ length: n }, () => alphabet[Math.floor(r() * alphabet.length)]).join("");
}

describe("scrubIdentity fuzz", () => {
  it("never throws and stays fast on random names and addresses full of regex metacharacters", () => {
    const r = rng(42);
    const alphabet = `abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456789 ${META}éñü`;
    let worst = 0;
    for (let i = 0; i < 300; i++) {
      const name = Array.from({ length: 1 + Math.floor(r() * 4) }, () => randomWord(r, alphabet)).join(" ");
      const address = `${Math.floor(r() * 9999)} ${Array.from({ length: 1 + Math.floor(r() * 6) }, () => randomWord(r, alphabet)).join(" ")}, Town`;
      const text = `${randomWord(r, alphabet)} ${name} at ${address} ${randomWord(r, alphabet)}`;
      const t0 = performance.now();
      const out = scrubIdentity(text, { name, address });
      worst = Math.max(worst, performance.now() - t0);
      expect(typeof out).toBe("string");
    }
    // Each call compiles fresh Unicode regexes (first compile is slow); 250 ms would still mean a pathological pattern.
    expect(worst).toBeLessThan(250);
  }, 60_000);

  it("stays fast when the address repeats one word many times (backtracking probe)", () => {
    for (const n of [10, 30, 60]) {
      const words = Array.from({ length: n }, () => "a").join(" ");
      const text = `1 ${Array.from({ length: Math.floor(n / 2) }, () => "a").join(" ")} a1 `.repeat(20);
      const t0 = performance.now();
      scrubIdentity(text, { name: "x", address: `1 ${words}` });
      expect(performance.now() - t0).toBeLessThan(200);
    }
  });

  it("removes every seeded applicant's full name wherever it appears, in any case", () => {
    for (const c of seed.cases) {
      for (const variant of [c.contact.name, c.contact.name.toUpperCase(), c.contact.name.toLowerCase()]) {
        const out = scrubIdentity(`Family of ${variant} lost the car`, c.contact);
        expect(out, `${c.id}: ${variant}`).not.toContain(variant);
      }
    }
  });

  it("leaves a summary that names no one alone", () => {
    const plain = "Basement flooded about 40 cm; furnace and water heater lost; household of 4";
    for (const c of seed.cases) expect(scrubIdentity(plain, c.contact), c.id).toBe(plain);
    for (const name of [...seed.bulk.names.en, ...seed.bulk.names.es]) expect(scrubIdentity(plain, { name, address: null }), name).toBe(plain);
  });
});

describe("scrubIdentity on the addresses the demo seeds", () => {
  it("removes the street of a seeded address with a unit (C-004: 23 Spring St Apt B)", () => {
    const contact = seed.cases.find((c) => c.id === "C-004")!.contact;
    expect(contact.address).toBe("23 Spring St Apt B, Cedar Falls");
    // "Mill Creek Rd" is removed for C-001; the same sentence for C-004 must lose "Spring St".
    expect(scrubIdentity("Water came up on Spring St; household of 5", contact)).not.toContain("Spring St");
  });

  it("removes the street of an address with a direction prefix or a leading unit", () => {
    expect(scrubIdentity("Flooding along Main Street", { name: "A B", address: "100 N Main St, Cedar Falls" })).not.toContain("Main Street");
    expect(scrubIdentity("Water at 22 Elm Street", { name: "A B", address: "Apt 4B, 22 Elm Street, Cedar Falls" })).not.toContain("22 Elm");
  });

  it("does not turn ordinary words into [redacted] because a surname is also a word (Flood, Stone)", () => {
    // C-010 is "M. Stone"; a flood-relief summary starting with "Flood" or "Stone" is ordinary.
    expect(scrubIdentity("Stone foundation cracked; household of 1", { name: "M. Stone", address: null })).toBe("Stone foundation cracked; household of 1");
  });
});
