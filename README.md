# AidRelay

> Cash in a survivor's hands in minutes, not weeks, with every dollar publicly traceable.

An autonomous disaster-relief **case officer**. Donations come in through PayPal, the agent verifies applications against a human-written policy, pays approved households through PayPal Payouts, and publishes an auditable ledger. Humans set the rules and handle exceptions; the agent does the work.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) (Devpost, Nov 2026). **Sandbox only.** MIT licensed.

> **Status:** Day 1 scaffold. The sections marked _TODO_ are filled in as the build progresses.

## For judges

_TODO (Day 4): hosted demo URL, sandbox donor/recipient logins, the 5-minute loop (`/apply?demo=C-001` → `/ops` → recipient balance → `/ledger`)._ The `/ops` admin password is in the Devpost testing instructions, not in this repo.

## The problem

_TODO: four linked sources from `docs/CONCEPT.md §3`._

## How it works

_TODO: architecture diagram (text only), the event-driven agent loop, the guardrails enforced in code._

- The policy the agent follows (published on the ledger): [`docs/policy.md`](docs/policy.md)

## PayPal APIs and AI models used

_TODO: Orders v2 (donations), Payouts v1 (disbursement), Webhooks (signature-verified), JS SDK v6 (donate button); Claude Sonnet 5.5 (agent loop, multimodal decision), Claude Haiku 5.5 (pre-screen)._

## Run it locally

```bash
pnpm install
cp .env.example .env            # fill in PayPal sandbox, Anthropic and GCP values
cp seed/accounts.example.json seed/accounts.json
pnpm check                       # every service reachable? (PayPal, Firestore, GCS, Anthropic)
pnpm seed                        # fund + cases + photos (donations are made by hand on /donate)
pnpm dev                         # http://localhost:3000
pnpm agent:sweep                 # let the Case Officer process the queue
pnpm typecheck && pnpm lint && pnpm test
```

Webhooks in development: expose port 3000 with ngrok and register `${APP_URL}/api/webhooks/paypal` in the PayPal developer dashboard.

## Non-goals

KYC/identity verification, live (non-sandbox) money, bank verification, multi-tenant auth, mobile app, SMS intake, email/SMS notifications, in-kind logistics.

## License

MIT, see [`LICENSE`](LICENSE).
