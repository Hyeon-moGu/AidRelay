// The donor account shown on /donate must be a PayPal sandbox account, never a real one.
import { describe, expect, it } from "vitest";
import { SANDBOX_DONOR } from "@/lib/demo-accounts";

describe("the sandbox donor account on /donate", () => {
  it("is a PayPal sandbox account, never a real one", () => {
    expect(SANDBOX_DONOR.email).toMatch(/@personal\.example\.com$/);
  });
});
