// The ledger's "Typical time to cash" is a median in tenths of a minute (lib/ledger/public.ts), so `duration`
// sees values like 119.6: it must never print "60 min" inside an hour count.
import { describe, expect, it } from "vitest";
import { duration } from "@/lib/format";

describe("duration", () => {
  it("rolls 59.5 to 59.99 minutes over to an hour", () => {
    expect(duration(59.6)).toBe("1 h");
  });
  it("never prints 60 minutes after an hour count", () => {
    expect(duration(119.6)).toBe("2 h");
    expect(duration(1439.7)).not.toMatch(/60 min/);
  });
  it("keeps whole values as they are", () => {
    expect(duration(23.4)).toBe("23 min");
    expect(duration(90)).toBe("1 h 30 min");
    expect(duration(null)).toBe("–");
  });
});
