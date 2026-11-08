import { describe, expect, it } from "vitest";
import { publicSummary } from "@/lib/ledger/labels";

describe("publicSummary", () => {
  it("drops tier numbers the model appends, wherever they sit", () => {
    expect(publicSummary("Flood water reached window level; household of 2 displaced, belongings destroyed. Tier 3.")).toBe(
      "Flood water reached window level; household of 2 displaced, belongings destroyed",
    );
    expect(publicSummary("Flooded laundry room with mud; home habitable, household of 3, tier 2")).toBe("Flooded laundry room with mud; home habitable, household of 3");
    expect(publicSummary("Garage flooded about 1 ft (tier 2); freezer and tools ruined.")).toBe("Garage flooded about 1 ft; freezer and tools ruined.");
  });

  it("leaves a summary without a tier alone", () => {
    const s = "Rental flooded ~2 ft, family of 5 with a toddler displaced.";
    expect(publicSummary(s)).toBe(s);
    expect(publicSummary("")).toBe("");
  });
});
