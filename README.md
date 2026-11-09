# AidRelay

> Cash in a survivor's hands in minutes, not weeks, with every dollar publicly traceable.

An autonomous disaster-relief **case officer**. Donations come in through PayPal, the agent reviews applications against a human-written policy, pays approved households through PayPal Payouts, and publishes an auditable ledger. Humans set the rules and handle exceptions; the agent does the work.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) (Devpost, Nov 2026). **Sandbox only.** MIT licensed.

## For judges

**Hosted demo:** https://aidrelay-545799830947.us-central1.run.app

Everything on it runs for real on the PayPal sandbox and Claude.

**No account needed:**

1. [`/ledger`](https://aidrelay-545799830947.us-central1.run.app/ledger): the live public ledger, an AG Studio report with every grant and its PayPal payout id. Click any bar, slice or payout to filter the whole report.
2. [`/policy`](https://aidrelay-545799830947.us-central1.run.app/policy): the rules the AI case officer follows.
3. [`/apply`](https://aidrelay-545799830947.us-central1.run.app/apply): apply with a zip code from 28501 to 28505, a photo of water damage and any email. Within about a minute your status link shows the agent's decision: paid, waiting for funds, a follow-up question, or human review. An email without a sandbox account still works; PayPal holds the payout and the ledger shows it under *On its way*.

**With an account:**

- **Donate** on [`/donate`](https://aidrelay-545799830947.us-central1.run.app/donate) as the sandbox donor below. The ledger shows it within seconds, and a family waiting for funds is paid right away.
- **Supervise the agent** on `/ops`: the review queue grouped by level of need, the agent's reasons, bulk approve, the live activity feed, and *Ask the ledger*, an auditor built on AG Studio's Agent Framework. The password is in the Devpost testing instructions.
- **See money arrive** by logging in as the C-001 recipient on [sandbox.paypal.com](https://www.sandbox.paypal.com).

**Sandbox test accounts:**

| Role | Email | Password | Use it to |
|---|---|---|---|
| Donor | `sb-e3oaw53770647@personal.example.com` | `3Y@}L@Zk` | pay on `/donate` |
| Recipient (case C-001) | `aidrelay-r1-f2b7@aidrelay-mail.com` | `q6MxhW6G#z` | see the grant the agent paid in the demo video |

Applying twice with the same email, address or photo sends the second application to human review (duplicate check, policy P-4). That includes the recipient account above, which case C-001 already uses, so apply with a different email.

## The problem

1. **Public aid starts with paperwork, at the moment of greatest need.** After Hurricane Helene, FEMA's Serious Needs Assistance was $750, and a FEMA official called misinformation "extremely damaging" because it made survivors less likely to register for assistance ([NPR, Oct 7 2024](https://www.wusf.org/2024-10-07/fact-checking-falsehoods-about-fema-funding-and-hurricane-helene)).
2. **Small funds run on tools that break under load.** Mutual-aid and neighborhood funds raise money fast and then pay it out through personal payment apps and spreadsheets. After the July 2025 Chantal floods in North Carolina, Triangle Mutual Aid hit transfer caps on its personal payment app, its donations were held, and volunteers spent days on the phone with support ([Triangle Blog Blog, Jul 17 2025](https://triangleblogblog.com/?p=14242)).
3. **Fast money without a ledger loses trust.** Austin Mutual Aid reported $2.6M raised after the 2021 Texas freeze; other organizers pointed out that its self-reported spreadsheet showed no backup for the numbers ([VICE, Jul 27 2021](https://www.vice.com/en/article/austin-mutual-aid-raised-millions-during-february-2021-texas-storm-freeze-where-is-it-now/)).
4. **Fast, verified cash works, but only at scale.** When SNAP benefits lapsed in November 2025, GiveDirectly sent nearly $12M in $50 payments to 238,153 families within one to two days of a missed deposit, with one partner to find the families and another to issue prepaid cards ([GiveDirectly](https://www.givedirectly.org/snap-response), [Fortune, Dec 24 2025](https://fortune.com/2025/12/24/government-shutdown-snap-payments-givedirectly-nonprofit-food-stamps/)). A five-volunteer flood fund has no such stack.

**Who it is for:** a small US community relief fund (a 501(c)(3) or a fiscally sponsored group) with a PayPal Business account, that raises tens of thousands of dollars after a declared disaster, receives hundreds of applications in two weeks, and has a handful of volunteers and no engineers. AidRelay is the review, pay and record stack such a fund lacks, running on the fund's own PayPal account.

## How it works

```
 Donor ----> /donate (PayPal JS SDK) ----> Orders API create + capture --+
 PayPal Webhooks --> /api/webhooks/paypal (signature verified) ---------+--> Firestore
 Applicant --> /apply (EN/ES, photos to Cloud Storage) --> new case ----+    fund, donations, cases,
                                                                            payouts, audit_log, agent_runs
                                      |
                                      v
   Case Officer agent (Claude Sonnet 5.5 + Vercel AI SDK, typed tools)
     wakes on: a new case | a captured donation | a volunteer's approval | a sweep
     tools:    get_policy, get_case, list_cases, check_duplicates, evaluate_case,
               get_fund_balance, plan_allocation, reserve_funds, create_payout,
               get_payout_status, request_info, escalate, note
     limits:   policy.md, enforced in code (guardrails, state machine, allocation)
                                      |
                                      v
   Payouts API, one batch per case ----> recipient's PayPal account
                                      |
              +-----------------------+------------------------+
              v                                                v
   /ops: operators supervise                       /ledger: the public audits
   (AG Grid queue, bulk approve, activity feed,    (AG Studio report, payout batch ids)
    Ask the ledger)
```

The agent is event-driven:

- **A new application** (`case.created`): check for duplicates, evaluate the photos and story against the policy, then pay, ask the applicant a follow-up question, or hand the case to a human with reasons.
- **A donation** (`donation.captured`): pay the cases that were waiting for funds, highest tier first, then first come (policy P-8).
- **A volunteer's approval** (`operator.command`): pay the approved cases in the same order, or park them until the fund has the money.
- **A sweep** (`pnpm agent:sweep` by hand, or every few minutes from Cloud Scheduler, set up by `scripts/schedule-sweep.sh`): pick up anything a lost trigger left behind, pay waiting cases the balance now covers and check payouts whose webhook is late. A sweep that finds nothing calls no model and records no run.

Payout webhooks are reconciled in code by the webhook route, without a model call: success marks the case paid, a failure releases the reserved money and sends the case to a human. Updates that change nothing (a batch moving to `PROCESSING`) are stored with the payout and kept out of the activity feed.

**The agent may approve. It may never reject.** Doubtful or ineligible cases go to the human queue with the agent's reasoning attached. The limits live in [`policy.md`](policy.md), written by the fund's humans and published at `/policy`, and they are enforced in code, not only in the prompt:

- It pays on its own only when all ten conditions in policy P-9 hold, among them: eligible, at most $250, confidence at least 0.85, no red flags, money available, usable evidence on file, a second independent evaluation that agrees, and inside the P-10 automation limits (20 grants per hour, $5,000 per day). See `lib/agent/guardrails.ts`.
- Amounts come from the policy's tiers, never from the model. A human-set amount is capped by P-7.
- One payout per case, idempotent: the Payouts `sender_batch_id` is derived from the case id, and money is reserved before any payout, so the fund never overdraws. If PayPal does not accept a payout, the case keeps its reservation and the agent does not try again on its own; a volunteer sends the same request again from `/ops`, with the same `sender_batch_id`, so the family still cannot be paid twice.
- The payment order (P-8) is computed in code, for new applications too: a new case is paid at once only if the plan would pay it ahead of the cases already waiting.
- Every status change goes through a per-actor state machine (`lib/agent/transitions.ts`): the agent cannot write `rejected`, cannot move a paid case and cannot override a human decision.
- The applicant's story is untrusted data: delimited in the prompt and scanned for instructions. Emails and phone numbers are scrubbed from everything the agent writes, and the applicant's own name and street address are removed, in code, from the one line that reaches the ledger.
- Every tool call is recorded and shown live in the `/ops` activity feed, and every change it makes to a case or the fund is written to the audit log with the policy clause it relied on.

## PayPal APIs and AI models used

| | Used for |
|---|---|
| **PayPal Orders API** | Donations: create and capture (`/v2/checkout/orders`). The capture response and the `PAYMENT.CAPTURE.COMPLETED` webhook both record the gift; whichever lands first counts it, the other is a no-op. |
| **PayPal Payouts API** | Grants: `POST /v1/payments/payouts`, one batch per case with an idempotent `sender_batch_id`; `GET` on the batch, on every sweep, as a backstop when a webhook is late. |
| **PayPal Webhooks** | Every event is verified with `/v1/notifications/verify-webhook-signature`, claimed once by event id (redeliveries are no-ops) and handled before PayPal gets its 200. |
| **PayPal JS SDK** | The donate button (`/sdk/js` Buttons). |
| **Claude Sonnet 5.5** | The Case Officer's agent loop (tool use through the Vercel AI SDK) and the multimodal decision on each case, returned as a schema-validated `Decision`. The policy and system prompt are prompt-cached. |
| **Claude Haiku 5.5** | Photo pre-screen before the decision: is each image usable evidence, and what does it show. Also the model behind *Ask the ledger* (below). |

Also: Next.js 15 (App Router), Firestore, Google Cloud Storage, Cloud Run, AG Grid Enterprise for the operator queue (grouping by tier, bulk selection, inline amount edit) and **AG Studio** for the public ledger (next section).

## How the public ledger uses AG Studio

`/ledger` is one AG Studio report in view mode, built from the anonymized ledger (a zip prefix, no contact details, and a one-line summary with the applicant's name and address removed) and kept live: the page re-reads `/api/ledger` every 10 seconds, so a donation and the payouts it unlocks appear while you watch.

- **Two custom widgets** (`app/ledger/studio-widgets.tsx`), registered with `createWidgets({ additionalTypes, overrides })`:
  - **Where the money is** (`fund-progress`): raised, paid, on its way, waiting for funds and not yet granted as one bar. It reads its numbers with `widgetApi.getData(..., { crossFilter: "highlight" })`, so selecting anything else in the report fades the bar and keeps the selected share solid ("Your selection: $1,750 paid to 5 households, 35% of everything paid so far"). When approved families are waiting, it says how much would pay them and links to `/donate`.
  - **Money in, money out** (`money-trail`): donations and payouts on one timeline, with how long each family waited and which payouts went out right after a donation. Clicking a payout calls `widgetApi.toggleCrossFilter`, which filters the charts, the fund bar and the grant table to that case.
- **Built-in widgets, configured**: a stacked column chart of grants by level of need, a donut of who approved each family (a volunteer or the AI case officer), and the full grant table with a total row, value-change flashes and custom cell renderers (status badges, approver icons, mono payout ids) through the grid override's `createCellRenderer`. Every bar, slice and payout cross-filters the rest.
- **Theming and layout**: `studioTheme.withParams` binds Studio to the site's CSS tokens (cards, borders, chart palette), so the report follows light and dark mode and is remounted when the scheme changes; `responsiveLayoutBreakpoints` give it a tablet layout and a stacked phone layout; `localeText` rewrites Studio's overlays and tooltips in the page's voice.
- **Fallback**: if Studio fails to load, an error boundary shows the same ledger as plain AG Grid tables (`app/ledger/page.tsx`).

### Ask the ledger: AG Studio's Agent Framework on Claude

`/ops/audit` (operators only, linked as *Ask the ledger* in `/ops`) opens the same report in edit mode with Studio's AI panel. A volunteer asks in plain English ("Which grants did the AI case officer approve without a volunteer?", "Compare every grant's amount with its policy amount", "Add a chart comparing the average minutes to cash for grants the AI approved and grants a volunteer approved") and gets an answer computed from the tables, with case ids and PayPal payout ids as evidence, or a new chart on the dashboard.

- **A custom agent talking to Studio's built-in agents.** Our *Ledger auditor* (`app/ops/audit/audit-studio.tsx`, a `directLlmRunner` with `view_schema`, `execute_query`, `view_report`, `view_widget` and `delegate_to`) is the primary agent. For charts it delegates to Studio's own *page* agent (adds the widget) and *widget* agent (maps the fields), then reads the widget back to confirm it shows data.
- **A swapped-in model.** Studio takes the model from an adapter you supply; every turn of every agent goes through our `AgLlmAdapter` (`app/ops/audit/claude-adapter.ts`) to `/api/ops/ask`, which runs Claude Haiku 5.5 through the Vercel AI SDK and streams Studio's AG-UI events back (`lib/ops/llm-bridge.ts`). The bridge also repairs the small argument mistakes a fast model makes (an object sent as a JSON string, a stray bracket) so a call is not wasted on a validation error.
- **Safe by construction.** The model only proposes tool calls; Studio runs them in the browser on the same anonymized tables as `/ledger`, so the model sees no contact details and no applicant names or addresses. The auditor cannot approve, pay or change anything, charts it adds stay in that browser tab, the Anthropic key never leaves the server, and the route refuses anyone who is not signed in as an operator, caps request size and limits how many model turns it will run.

```
 AI panel (AG Studio, edit mode)
   └─ Ledger auditor (our agent: view_schema, execute_query, view_report, view_widget, delegate_to, rename_thread)
        ├─ delegate_to → page agent   (Studio built-in: adds and positions the widget)
        ├─ delegate_to → widget agent (Studio built-in: maps fields, sets the title)
        └─ delegate_to → data agent   (Studio built-in: data questions)
   every agent's turns → claudeAdapter (AgLlmAdapter) → POST /api/ops/ask → AI SDK streamText → Claude Haiku 5.5
   tool calls ← run by Studio in the browser on the anonymized grants, donations and fund tables
```

Studio APIs used: `createAiHarness` with a builder, `directLlmRunner` for our agent and for the built-in `data`, `page` and `widget` agents, `AgLlmAdapter`, `ctx.studio.*` tools, `tools.delegateTo`, `tools.renameThread`, prompt starters, a telemetry observer (each question shows its turns, agents, tokens and cost above the report) and `AgStudioAiModule`. The grants table carries a code-computed *Policy amount* (grant level plus the household rule), so "check every grant against the rules" compares numbers instead of reading summaries. Thinking is off on this route because Studio's conversation history has no place for signed thinking blocks; the system prompt and the tool catalogue are prompt-cached, which keeps a 15-turn chart request at one to two cents.

## Run it locally

```bash
pnpm install
cp .env.example .env                               # PayPal sandbox app, Anthropic key, GCP project and bucket
cp seed/accounts.example.json seed/accounts.json   # your sandbox account emails
pnpm check          # is every service reachable? (PayPal token, Payouts, webhook, Firestore, GCS, Anthropic)
pnpm seed --placeholders    # the fund and 22 fictional cases; gray placeholders for photos not in seed/photos
pnpm dev            # http://localhost:3000
```

The seed photos are not in the repository. With `--placeholders` every seeded case therefore comes back as `needs_info`, because the agent cannot see damage in a gray placeholder; to watch an automatic payout locally, apply on `/apply` with a real photo, or put your own images in `seed/photos` under the names `seed/cases.json` lists.

Then donate on `/donate` as your sandbox donor and run `pnpm agent:sweep` to let the Case Officer work through the queue. Donations are never seeded: an Orders capture needs the donor's approval in a browser, and the ledger only shows real sandbox captures. [`seed/README.md`](seed/README.md) describes the seed cases, the photos and the demo arithmetic.

Webhooks in development: expose port 3000 (for example with ngrok) and register `${APP_URL}/api/webhooks/paypal` in the PayPal developer dashboard.

Tests: `pnpm typecheck && pnpm lint && pnpm test` (guardrails, the status state machine, evaluation rules, duplicate photos, allocation, payouts and payout retries, PayPal events, applicant intake, operator decisions, what a sweep records, the ledger's anonymization, the auditor's model bridge and the seed data).

## Known limits

- **Evidence is a photo and a story, not an identity check.** What the agent can lose is capped in code instead: at most $250 per payout it makes on its own, 20 such payouts an hour and $5,000 a day (P-9, P-10), one payout per case, and anything that repeats a photo, an address or a contact goes to a volunteer.
- **PayPal's fees are not on the ledger yet.** *Raised* is what donors gave; the fees PayPal charges the fund (for example on each payout) are not subtracted, so the fund's real PayPal balance is lower than *Available*.
- **A refunded or disputed donation** is recorded but not taken out of *Raised*.
- **A payout that fails after PayPal accepted it** (failed, returned, or unclaimed for 30 days) gives its money back to the fund and returns to a volunteer, but it cannot be issued a second time from the console yet.

## Non-goals

KYC and identity verification, live (non-sandbox) money, bank verification, multi-tenant auth, a mobile app, SMS intake, email or SMS notifications (applicants read messages on their status page), in-kind logistics.

## License

MIT, see [`LICENSE`](LICENSE).
