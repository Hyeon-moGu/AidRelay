import { describe, expect, it } from "vitest";
import { stripPii, zipPrefix } from "@/lib/ledger/anonymize";

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

describe("zipPrefix", () => {
  it("keeps the first three digits only", () => {
    expect(zipPrefix("28501")).toBe("285");
    expect(zipPrefix("28501-1234")).toBe("285");
  });
});
