# Relief Fund Policy — v1 (demo template)

This document is written by the fund's humans and read by the Case Officer agent on every decision.
The agent cites clause IDs (P-1 … P-9) in its reasoning and must never act outside §5.
Edit this file to change the agent's behavior; no code change needed.

## 1. Scope
- **P-1 Event.** Assistance is for households affected by the *Cedar County Flood* (fictional demo event), declared on 2026-11-01.
- **P-2 Area.** Primary residence must be in the declared area: zip codes beginning `285` (demo). Applicants outside the area are `needs_info` (ask for proof of residence), not ineligible.

## 2. Eligibility
- **P-3 Evidence.** At least one photo or document showing damage, displacement, or loss of income tied to the event. Photos are assessed for: standing water, structural damage, debris, destroyed belongings, evacuation notices.
- **P-4 One grant per household.** Duplicate applicants (same address, contact, or photo) are flagged; the agent never pays a second grant to the same household.
- **P-5 Completeness.** Missing household size, contact, or evidence → `needs_info` with follow-up questions in the applicant's language.

## 3. Tiers and amounts (USD)
| Tier | Description | Amount |
|---|---|---|
| 1 | Minor loss (spoiled food, short outage) | $100 |
| 2 | Moderate damage, home habitable | $250 |
| 3 | Displaced or home uninhabitable | $350 |
| 4 | Displaced + dependents or medical need | $500 |

- **P-6 Household adjustment.** +$50 per household member beyond 4, max +$150.
- **P-7 Requested vs. recommended.** The agent recommends by tier; it never recommends more than the tier maximum plus P-6.

## 4. Allocation when funds are short
- **P-8 Rule.** Pay by tier descending (4 → 1), then first-come within a tier. Cases that cannot be funded are `parked` and re-evaluated automatically on every new donation.
- Alternatives a human may switch to by editing this line: `first-come` · `lottery-within-tier`.

## 5. Agent authority (enforced in code)
- **P-9 Auto-approve.** The agent may approve and pay without a human when ALL are true:
  1. eligibility = `eligible`
  2. tier ≥ 1 (every tier qualifies in this demo; a fund may raise this minimum to keep low tiers out of auto-pay — the $250 cap in rule 3 is the real limit)
  3. recommended amount ≤ **$250** (`AUTO_APPROVE_LIMIT`)
  4. confidence ≥ **0.85**
  5. no red flags
  6. fund balance covers the amount after reservation
  7. no prior payout for this case
- Anything else → human queue (`needs_review` / `needs_info` / `parked`).
- **The agent may never set `rejected`.** Only a named human can.

## 6. Communication
- Follow-up questions and status messages are sent in the applicant's language (EN/ES in demo).
- Tone: plain, short, no legal language, never ask for information not required by this policy.

## 7. Privacy
- The public ledger shows: zip prefix (3 digits), tier, amount, PayPal batch ID, a one-line AI summary with no names, addresses, or contact details, and whether a human reviewed the case.
- Photos and contact details are never public.

## 8. Change log
- v1 — initial demo policy.
- v1 (2026-11-07) — P-9 auto-approve tier minimum lowered from 2 to 1: the smallest grants are the safest to automate, and the amount cap already limits exposure.
