// Policy §7: the public line carries no health information, and lib/ledger/anonymize.ts says scrubHealth "holds it
// in code". These are ordinary ways a summary mentions health that the word list does not cover yet, including
// a Spanish line (the prompt does not require the summary to be in English).
import { describe, expect, it } from "vitest";
import { scrubHealth } from "@/lib/ledger/anonymize";

describe("scrubHealth beyond the current word list", () => {
  it.each([
    ["Family of 4 displaced, grandmother medically fragile", "Family of 4 displaced"],
    ["Family of 4 displaced, mother has dementia", "Family of 4 displaced"],
    ["Displaced; child with a heart condition", "Displaced"],
    ["Displaced; father lost his pills and walker", "Displaced"],
    ["Familia de 4 desplazada, niño con asma perdió sus medicinas", "Familia de 4 desplazada"],
  ])("%s", (line, expected) => {
    expect(scrubHealth(line)).toBe(expected);
  });
});
