# AidRelay

> Cash in a survivor's hands in minutes, not weeks, with every dollar publicly traceable.

An autonomous disaster-relief **case officer**. Donations come in through PayPal, the agent reviews applications against a human-written policy, pays approved households through PayPal Payouts, and publishes an auditable ledger. Humans set the rules and handle exceptions; the agent does the work.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) (Devpost, Nov 2026). **Sandbox only.** MIT licensed.

<!-- After recording: the demo video link and a screenshot of /ledger go here. -->

**What is different**

- **The agent may approve. It may never reject.** A doubtful or ineligible case goes to a volunteer with the agent's reasons attached.
- **Its authority is a policy file, enforced in code.** On its own it pays at most $250 per case, 20 cases an hour and $5,000 a day, once per case, and only with photo evidence and a second evaluation that agrees.
- **Every payment is public.** The ledger lists each grant with its PayPal payout id and no names, and it updates while you watch.
- **A donation pays the families already waiting**, greatest need first, as soon as PayPal captures it.

**Why PayPal**

- A family is paid to an email address. With a PayPal account the money is there within minutes; without one, PayPal holds it until the family claims it.
- A payout nobody claims goes back to the fund by itself after 30 days.
- Every donation and every grant has a PayPal id, and the ledger publishes it, so the fund's books can be checked against PayPal's.

## For judges

**Hosted demo:** https://aidrelay-545799830947.us-central1.run.app

Everything on it runs for real on the PayPal sandbox and Claude.

**No account needed:**

1. [`/ledger`](https://aidrelay-545799830947.us-central1.run.app/ledger): the live public ledger, an AG Studio report with every grant and its PayPal payout id. Click any bar, slice or payout to filter the whole report.
2. [`/policy`](https://aidrelay-545799830947.us-central1.run.app/policy): the rules the AI case officer follows.
3. [`/apply`](https://aidrelay-545799830947.us-central1.run.app/apply): apply with a zip code that starts with 285 (for example 28501), a photo of water damage and any email. Within about a minute your status link shows the agent's decision: paid, waiting for funds, a follow-up question, or a volunteer's review. An email without a sandbox account still works; PayPal holds the payout and the ledger shows it under *On its way*.

**With an account:**

- **Donate** on [`/donate`](https://aidrelay-545799830947.us-central1.run.app/donate) as the sandbox donor below. The ledger shows it within seconds, and a family waiting for funds is paid right away.
- **Supervise the agent** on `/ops`, the operator console: the review queue grouped by level of need, the agent's reasons, bulk approve, the live activity feed, and *Ask the ledger*, an auditor built on AG Studio's Agent Framework. The password is in the Devpost testing instructions.
- **See money arrive** by logging in as the C-001 recipient on [sandbox.paypal.com](https://www.sandbox.paypal.com).

**Sandbox test accounts:**

| Role | Email | Password | Use it to |
|---|---|---|---|
| Donor | `sb-e3oaw53770647@personal.example.com` | `3Y@}L@Zk` | pay on `/donate` |
| Recipient (case C-001) | `aidrelay-r1-f2b7@aidrelay-mail.com` | `q6MxhW6G#z` | see the grant the agent paid in the demo video |

Applying twice with the same email, address or photo sends the second application to a volunteer (duplicate check, policy P-4). That includes the recipient account above, which case C-001 already uses, so apply with a different email.

## The problem

**Who it is for:** a small US community relief fund (a 501(c)(3) or a fiscally sponsored group) with a PayPal Business account. It raises tens of thousands of dollars after a declared disaster, receives hundreds of applications in two weeks, and has a handful of volunteers and no engineers. AidRelay is the review, pay and record stack such a fund lacks, running on the fund's own PayPal account.

1. **Public aid starts with an application, at the moment of greatest need.** After Hurricane Helene, FEMA's Serious Needs Assistance was $750, and a FEMA official called misinformation "extremely damaging" because it made survivors less likely to register for assistance ([NPR, Oct 7 2024](https://www.wusf.org/2024-10-07/fact-checking-falsehoods-about-fema-funding-and-hurricane-helene)).
2. **Small funds run on tools that break under load.** Mutual-aid and neighborhood funds raise money fast and then pay it out through personal payment apps and spreadsheets. After the July 2025 Chantal floods in North Carolina, Triangle Mutual Aid hit transfer caps on its personal payment app, its donations were held, and volunteers spent days on the phone with support ([Triangle Blog Blog, Jul 17 2025](https://triangleblogblog.com/?p=14242)).
3. **Fast money without a ledger loses trust.** Austin Mutual Aid reported $2.6M raised after the 2021 Texas freeze; other organizers pointed out that its self-reported spreadsheet showed no backup for the numbers ([VICE, Jul 27 2021](https://www.vice.com/en/article/austin-mutual-aid-raised-millions-during-february-2021-texas-storm-freeze-where-is-it-now/)).
4. **Fast, verified cash works, but only at scale.** When SNAP benefits lapsed in November 2025, GiveDirectly sent nearly $12M in $50 payments to 238,153 families within one to two days of a missed deposit, with one partner to find the families and another to issue prepaid cards ([GiveDirectly](https://www.givedirectly.org/snap-response), [Fortune, Dec 24 2025](https://fortune.com/2025/12/24/government-shutdown-snap-payments-givedirectly-nonprofit-food-stamps/)). A five-volunteer flood fund has no such stack.

## How it works

```
 Donor ----> /donate (PayPal JS SDK) ----> Orders API create + capture --+
 PayPal Webhooks --> /api/webhooks/paypal (signature verified) ---------+--> Firestore
 Applicant --> /apply (EN/ES, photos to Cloud Storage) --> new case ----+    fund, donations, cases,
                                                                            payouts, audit_log, agent_runs
                                      |
                                      v
   Case Officer agent (Claude Sonnet 5.5 through the AI SDK, typed tools)
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
   /ops: volunteers supervise                      /ledger: the public audits
   (AG Grid queue, bulk approve, activity feed,    (AG Studio report, payout batch ids)
    Ask the ledger)
```

The agent is event-driven:

- **A new application** (`case.created`): check for duplicates, evaluate the photos and story against the policy, then pay, ask the applicant a follow-up question, or hand the case to a volunteer with reasons.
- **A donation** (`donation.captured`): pay the cases that were waiting for funds, highest tier first, then first come (policy P-8).
- **A volunteer's approval** (`operator.command`): pay the approved cases in the same order, or park them until the fund has the money.
- **A sweep** (`pnpm agent:sweep`, or on a schedule with `scripts/schedule-sweep.sh`): retry anything a lost trigger left behind, pay waiting cases the balance now covers, and check payouts whose webhook is late. An idle sweep calls no model.

Payout webhooks are reconciled in code by the webhook route, without a model call. Success marks the case paid; a failure releases the reserved money and sends the case to a volunteer.

## What the code enforces

The limits live in [`policy.md`](policy.md), written by the fund's people and published at `/policy`. They are enforced in code, not only in the prompt:

| Guarantee | Enforced in | Tests |
|---|---|---|
| The agent pays on its own only when all ten conditions of policy P-9 hold: eligible, at most $250, confidence at least 0.85, no red flags, money available, usable photo evidence, a second independent evaluation that agrees, and inside the P-10 limits (20 grants an hour, $5,000 a day). | `lib/agent/guardrails.ts` | `guardrails.test.ts` |
| It cannot reject, cannot move a paid case and cannot override a volunteer's decision. Every status write goes through a state machine per actor. | `lib/agent/transitions.ts` | `transitions.test.ts` |
| Amounts come from the policy's tiers, never from the model. A volunteer's amount is capped (P-7). | `lib/agent/evaluate.ts`, `lib/agent/policy.ts` | `evaluate.test.ts`, `policy.test.ts` |
| One payout per case and no overdraft: money is reserved before any payout, and the Payouts `sender_batch_id` is derived from the case id. | `lib/db/repos/fund.ts`, `lib/db/repos/payouts.ts` | `repos.test.ts` |
| A payout PayPal did not accept is never retried by the agent. A volunteer sends the same request again from `/ops`, with the same `sender_batch_id`, so the family still cannot be paid twice. | `lib/db/repos/payouts.ts` | `payout-retry.test.ts` |
| The payment order (P-8) is computed in code, for new applications too: nobody jumps a family that is already waiting. | `lib/agent/allocation.ts` | `allocation.test.ts`, `evaluate-tool.test.ts` |
| The applicant's story is untrusted data: delimited in the prompt and scanned for instructions, and a hit goes to a volunteer. | `lib/agent/evaluate.ts`, `lib/agent/prompts.ts` | `evaluate.test.ts` |
| The ledger carries no contact details. Emails and phone numbers are scrubbed from everything the agent writes, and the applicant's own name and street address from the one line that is published. | `lib/ledger/anonymize.ts` | `anonymize.test.ts` |
| Every tool call is shown live in the `/ops` activity feed, and every change to a case or the fund is written to the audit log with the policy clause it relied on. | `lib/agent/tools.ts`, `lib/db/repos/audit.ts` | `officer.test.ts` |

## PayPal APIs and AI models used

| | Used for |
|---|---|
| **PayPal Orders API** | Donations: create and capture (`/v2/checkout/orders`). The capture response and the `PAYMENT.CAPTURE.COMPLETED` webhook both record the gift; whichever lands first counts it, the other is a no-op. |
| **PayPal Payouts API** | Grants: `POST /v1/payments/payouts`, one batch per case with an idempotent `sender_batch_id`; `GET` on the batch, on every sweep, as a backstop when a webhook is late. |
| **PayPal Webhooks** | Every event is verified with `/v1/notifications/verify-webhook-signature`, claimed once by event id (redeliveries are no-ops) and handled before PayPal gets its 200. |
| **PayPal JS SDK** | The donate button (`/sdk/js` Buttons). |
| **Claude Sonnet 5.5** | The Case Officer's agent loop and the multimodal decision on each case, returned as a schema-validated `Decision`. The policy and system prompt are prompt-cached. |
| **Claude Haiku 5.5** | Photo pre-screen before the decision: is each image usable evidence, and what does it show. Also the model behind *Ask the ledger* (below). |
| **AI SDK** (`ai` and `@ai-sdk/anthropic`, the library from Vercel) | How the code calls Claude: the tool-calling loop (`generateText`), the schema-validated decision (`generateObject`) and the auditor's stream (`streamText`). It is a library, not a host. |

Also: Next.js 15 (App Router), Firestore, Google Cloud Storage and Cloud Run, where the app is hosted.

## AG Grid and AG Studio

| What the prize looks for | Where it is |
|---|---|
| Custom widgets | Two of our own on the public ledger: *Where the money is* (`fund-progress`) and *Money in, money out* (`money-trail`), in `app/ledger/studio-widgets.tsx`. |
| Theming | `studioTheme.withParams` binds Studio to the site's CSS tokens, so the report follows light and dark mode (`app/ledger/ledger-studio.tsx`). |
| Layout | One authored report with a tablet layout and a stacked phone layout through `responsiveLayoutBreakpoints` (`app/ledger/studio-layout.ts`). |
| More than a grid and charts on their own | Every bar, slice and payout cross-filters the other widgets, ours included. |
| A custom agent talking to Studio's built-in agents | The *Ledger auditor* answers from the tables and hands chart work to Studio's page, widget and data agents (`app/ops/audit/audit-studio.tsx`). |
| Your own model behind the Agent Framework | Every turn of every agent goes through our `AgLlmAdapter` to Claude Haiku 5.5 (`app/ops/audit/claude-adapter.ts`, `lib/ops/llm-bridge.ts`). |
| AG Grid Enterprise | The `/ops` review queue: grouped by level of need, bulk selection, inline amount edit. |

### The public ledger

`/ledger` is one AG Studio report in view mode. It is built from the anonymized ledger and re-reads `/api/ledger` every 10 seconds, so a donation and the payouts it unlocks appear while you watch.

- **Where the money is**: raised, paid, on its way, waiting for funds and not yet granted, as one bar. Select anything else in the report and the bar keeps only the selected share solid. When approved families are waiting, it says how much would pay them and links to `/donate`.
- **Money in, money out**: donations and payouts on one timeline, with how long each family waited and which payouts went out right after a donation. Clicking a payout filters the whole report to that case.

### Ask the ledger

`/ops/audit` opens the same report in edit mode with Studio's AI panel, for signed-in volunteers. A volunteer asks in plain English ("Which grants did the AI case officer approve without a volunteer?", "Add a chart comparing how fast the AI and volunteers get money to families"). The answer is computed from the tables, with case ids and PayPal payout ids as evidence, or it is a new chart on the dashboard.

```
 AI panel (AG Studio, edit mode)
   └─ Ledger auditor (our agent: view_schema, execute_query, view_report, view_widget, delegate_to, rename_thread)
        ├─ delegate_to → page agent   (Studio built-in: adds and positions the widget)
        ├─ delegate_to → widget agent (Studio built-in: maps fields, sets the title)
        └─ delegate_to → data agent   (Studio built-in: data questions)
   every agent's turns → claudeAdapter (AgLlmAdapter) → POST /api/ops/ask → AI SDK streamText → Claude Haiku 5.5
   tool calls ← run by Studio in the browser on the anonymized grants, donations and fund tables
```

The auditor reads and draws; it cannot approve, pay or change anything. The model only proposes tool calls, and Studio runs them in the browser on the same anonymized tables as `/ledger`, so the model sees no contact details and no applicant names or addresses.

<details>
<summary>Studio APIs used, and the details behind each row</summary>

**Ledger**

- Built-in widgets, configured: a stacked column chart of grants by level of need, a donut of who approved each family (a volunteer or the AI case officer), and the full grant table with a total row.
- If Studio fails to load, an error boundary shows the same ledger as plain AG Grid tables (`app/ledger/page.tsx`).
- The two custom widgets are registered with `createWidgets({ additionalTypes, overrides })`.
- *Where the money is* reads its numbers with `widgetApi.getData(..., { crossFilter: "highlight" })`, which is how it shows the selected share ("Your selection: $1,750 paid to 5 households, 35% of everything paid so far").
- *Money in, money out* calls `widgetApi.toggleCrossFilter` when a payout is clicked.
- The grant table uses value-change flashes and custom cell renderers (status badges, approver icons, mono payout ids) through the grid override's `createCellRenderer`.
- The report is remounted when the color scheme changes, and `localeText` rewrites Studio's overlays and tooltips in the page's voice.

**Auditor**

- `createAiHarness` with a builder; `directLlmRunner` for our agent and for the built-in `data`, `page` and `widget` agents; `AgLlmAdapter`; `ctx.studio.*` tools; `tools.delegateTo`; `tools.renameThread`; prompt starters; `AgStudioAiModule`.
- For a chart, the auditor delegates to the page agent (adds the widget) and the widget agent (maps the fields), then reads the widget back to confirm it shows data.
- `/api/ops/ask` streams Studio's AG-UI events back (`lib/ops/llm-bridge.ts`). The bridge repairs the small argument mistakes a fast model makes (an object sent as a JSON string, a stray bracket), so a call is not wasted on a validation error.
- A telemetry observer shows, above the report, what each question took: turns, agents, tokens and cost.
- The grants table carries a code-computed *Policy amount* (grant level plus the household rule), so "check every grant against the rules" compares numbers instead of reading summaries.
- Thinking is off on this route because Studio's conversation history has no place for signed thinking blocks. The system prompt and the tool catalogue are prompt-cached, which keeps a 15-turn chart request at one to two cents.
- The Anthropic key never leaves the server. The route refuses anyone who is not signed in, caps request size and limits how many model turns it will run. Charts the auditor adds stay in that browser tab.

</details>

## Run it locally

You need a PayPal sandbox app, an Anthropic API key and a Google Cloud project.

<details>
<summary>Setting up the PayPal sandbox and Google Cloud</summary>

1. **PayPal**: on developer.paypal.com create a sandbox app and enable **Payouts** in its features (payouts fail without it). Create sandbox accounts: one business account for the fund with a balance to pay from, one personal account for the donor, and one personal account for each recipient you want to see paid.
2. **Webhook**: register `${APP_URL}/api/webhooks/paypal` (a public URL, for example through ngrok) for `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.PAYOUTSBATCH.*` and `PAYMENT.PAYOUTS-ITEM.*`, and put its id in `PAYPAL_WEBHOOK_ID`.
3. **Google Cloud**: a Firestore database and a Cloud Storage bucket. Credentials come from `gcloud auth application-default login`, or from a key file named in `GOOGLE_APPLICATION_CREDENTIALS`.

</details>

```bash
pnpm install
cp .env.example .env                               # PayPal sandbox app, Anthropic key, GCP project and bucket
cp seed/accounts.example.json seed/accounts.json   # your sandbox account emails
pnpm check          # is every service reachable? (PayPal token, Payouts, webhook, Firestore, GCS, Anthropic)
pnpm seed --placeholders    # the fund and 22 fictional cases; gray placeholders for photos not in seed/photos
pnpm dev            # http://localhost:3000
```

The seed photos are not in the repository. With `--placeholders` every seeded case therefore comes back as `needs_info`, because the agent cannot see damage in a gray placeholder. To watch an automatic payout locally, apply on `/apply` with a real photo, or put your own images in `seed/photos` under the names `seed/cases.json` lists.

Then donate on `/donate` as your sandbox donor and run `pnpm agent:sweep` to let the Case Officer work through the queue. Donations are never seeded: an Orders capture needs the donor's approval in a browser, and the ledger only shows real sandbox captures. [`seed/README.md`](seed/README.md) describes the seed cases, the photos and the demo arithmetic.

**Tests:** `pnpm typecheck && pnpm lint && pnpm test`. More than 200 tests cover the guardrails, the state machine, evaluation rules, duplicate photos, allocation, payouts and payout retries, PayPal events, applicant intake, volunteer decisions, what a sweep records, the ledger's anonymization, the auditor's model bridge and the seed data. They run against an in-memory database with PayPal and the model mocked, so they move no money.

## Limits and non-goals

- **Evidence is a photo and a story, not an identity check.** What the agent can lose is capped in code instead: at most $250 per payout it makes on its own, 20 such payouts an hour and $5,000 a day (P-9, P-10), and one payout per case. Anything that repeats a photo, an address or a contact goes to a volunteer.
- **PayPal's fees are not on the ledger yet.** *Raised* is what donors gave; the fees PayPal charges the fund (for example on each payout) are not subtracted, so the fund's real PayPal balance is lower than *Available*.
- **A refunded or disputed donation** is recorded but not taken out of *Raised*.
- **A payout that fails after PayPal accepted it** (failed, returned, or unclaimed for 30 days) gives its money back to the fund and returns to a volunteer, but it cannot be issued a second time from the console yet.

Out of scope on purpose: KYC and identity verification, live (non-sandbox) money, bank verification, multi-tenant auth, a mobile app, SMS intake, email or SMS notifications (applicants read messages on their status page), in-kind logistics.

## License

MIT, see [`LICENSE`](LICENSE).
