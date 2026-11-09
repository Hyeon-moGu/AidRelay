import { describe, expect, it } from "vitest";
import { scrubIdentity, stripPii, zipPrefix } from "@/lib/ledger/anonymize";

describe("stripPii", () => {
  it("drops payer and contact fields at any depth, keeps money and ids", () => {
    const order = {
      id: "5O190127TN364715T",
      status: "COMPLETED",
      payer: { email_address: "donor@example.com", name: { given_name: "Dana" } },
      purchase_units: [
        {
          amount: { currency_code: "USD", value: "20.00" },
          shipping: { address: { address_line_1: "412 Mill Creek Rd" } },
          payments: {
            captures: [{ id: "3C679366HH908993F", status: "COMPLETED", payee: { email_address: "fund@x" } }],
          },
        },
      ],
    };
    expect(stripPii(order)).toEqual({
      id: "5O190127TN364715T",
      status: "COMPLETED",
      purchase_units: [
        {
          amount: { currency_code: "USD", value: "20.00" },
          payments: { captures: [{ id: "3C679366HH908993F", status: "COMPLETED", payee: {} }] },
        },
      ],
    });
  });

  it("does not mutate its input", () => {
    const input = { payer: { email_address: "a@b" }, id: "1" };
    stripPii(input);
    expect(input.payer.email_address).toBe("a@b");
  });
});

describe("scrubIdentity (the applicant's own name and address never reach the public line)", () => {
  const dana = { name: "Dana Whitfield", address: "412 Mill Creek Rd, Cedar Falls" };

  it("removes the full name and each part of it, however it is capitalized", () => {
    expect(scrubIdentity("Dana Whitfield's kitchen flooded; family of 3", dana)).toBe("[redacted]'s kitchen flooded; family of 3");
    expect(scrubIdentity("Kitchen flooded. Whitfield household of 3, DANA displaced", dana)).toBe("Kitchen flooded. [redacted] household of 3, [redacted] displaced");
    expect(scrubIdentity("dana whitfield lost a washer", dana)).toBe("[redacted] lost a washer");
  });

  it("leaves an ordinary word alone when it only looks like a name in lower case", () => {
    const rose = { name: "Rose Waters", address: null };
    expect(scrubIdentity("Flood waters rose two feet in the kitchen", rose)).toBe("Flood waters rose two feet in the kitchen");
    expect(scrubIdentity("Rose Waters reports two feet of water", rose)).toBe("[redacted] reports two feet of water");
  });

  it("removes the street address in the forms it is likely to be written", () => {
    expect(scrubIdentity("Home at 412 Mill Creek Rd, Cedar Falls flooded", dana)).toBe("Home at [redacted] flooded");
    expect(scrubIdentity("Home at 412 Mill Creek Road flooded 4 in.", dana)).toBe("Home at [redacted] flooded 4 in.");
    expect(scrubIdentity("412 Mill Creek flooded; family of 3", dana)).toBe("[redacted] flooded; family of 3");
    expect(scrubIdentity("House on Mill Creek Rd. flooded", dana)).toBe("House on [redacted] flooded");
  });

  it("keeps the facts: a creek that shares the street's name, numbers that are not the house number", () => {
    expect(scrubIdentity("Mill Creek overflowed; 4 in. of water, household of 3", dana)).toBe("Mill Creek overflowed; 4 in. of water, household of 3");
    expect(scrubIdentity("About 412 sq ft of flooring lost", dana)).toBe("About 412 sq ft of flooring lost");
  });

  it("handles names outside ASCII and a contact with nothing to remove", () => {
    expect(scrubIdentity("José Núñez perdió la cocina", { name: "José Núñez", address: "" })).toBe("[redacted] perdió la cocina");
    expect(scrubIdentity("Flooded kitchen, family of 3", { name: "", address: null })).toBe("Flooded kitchen, family of 3");
  });
});

describe("zipPrefix", () => {
  it("keeps the first three digits only", () => {
    expect(zipPrefix("28501")).toBe("285");
    expect(zipPrefix("28501-1234")).toBe("285");
  });
});
