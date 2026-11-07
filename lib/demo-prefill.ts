// `/apply?demo=C-001` prefills the form from seed/cases.json so the on-camera application takes seconds.
// Server-only; the recipient email comes from seed/accounts.json when it exists (git-ignored), else stays blank.
import { readFileSync } from "node:fs";
import path from "node:path";

export interface Prefill {
  lang: "en" | "es";
  name: string;
  email: string;
  phone: string;
  address: string;
  zip: string;
  householdSize: string;
  requestedAmountDollars: string;
  narrative: string;
}

interface SeedCase {
  id: string;
  lang: string;
  zip: string;
  householdSize: number | null;
  requestedAmountCents: number | null;
  narrative: string;
  contact: { name: string; email: string; phone: string | null; address: string | null };
}

export function demoPrefill(caseId: string | undefined): Prefill | undefined {
  if (!caseId || !/^C-\d{3}$/.test(caseId)) return undefined;
  try {
    const seed = JSON.parse(readFileSync(path.join(process.cwd(), "seed", "cases.json"), "utf8")) as { cases: SeedCase[] };
    const c = seed.cases.find((x) => x.id === caseId);
    if (!c) return undefined;
    let email = "";
    const token = /^\{\{(\w+)\}\}$/.exec(c.contact.email)?.[1];
    if (token) {
      try {
        const accounts = JSON.parse(readFileSync(path.join(process.cwd(), "seed", "accounts.json"), "utf8")) as Record<string, { email?: string }>;
        email = accounts[token]?.email ?? "";
      } catch {
        email = "";
      }
    }
    return {
      lang: c.lang === "es" ? "es" : "en",
      name: c.contact.name,
      email,
      phone: c.contact.phone ?? "",
      address: c.contact.address ?? "",
      zip: c.zip,
      householdSize: c.householdSize === null ? "" : String(c.householdSize),
      requestedAmountDollars: c.requestedAmountCents === null ? "" : String(c.requestedAmountCents / 100),
      narrative: c.narrative,
    };
  } catch {
    return undefined;
  }
}
