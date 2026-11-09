// Next.js passes a repeated query parameter as an array: /apply?lang=es&lang=en gives searchParams.lang = ["es", "en"].
// The apply and status pages hand that value to normalizeLang, so it must not throw (today both pages answer 500).
import { describe, expect, it } from "vitest";
import { normalizeLang } from "@/lib/i18n/messages";

describe("normalizeLang with a repeated query parameter", () => {
  it("never throws on an array and picks a supported language", () => {
    const repeated = ["es", "en"] as unknown as string;
    expect(() => normalizeLang(repeated)).not.toThrow();
    expect(["en", "es"]).toContain(normalizeLang(repeated));
  });
});
