# Seed data

Everything here is fictional: Cedar County, Cedar Falls, every name, address, and photo. **Never add real disaster or real victim photos.**

## Files
- `cases.json`, 10 hand-crafted cases (3 auto-pay, 3 human-approve, 2 needs-info, 2 flagged; 2 in Spanish) + a `bulk` generator spec for 12 more (8 `tier2_clean`, 4 `tier3_displaced`).
- `accounts.example.json`, template for the sandbox account mapping. Copy to `accounts.json` (git-ignored). Every case pays to its own account: policy P-4 flags a repeated contact, so two cases sharing one payout email would be treated as one household.
- `photos/`, one image per hand-crafted photo and document path (C-004's pharmacy list too), plus `photos/pool/` with 12 distinct images for the bulk cases, named `tier2_clean-01.jpg` … `tier2_clean-08.jpg` and `tier3_displaced-01.jpg` … `tier3_displaced-04.jpg`.

## Making the photos (Day 2, ~1 hour)
The agent is multimodal: placeholder images will make it answer `needs_info` for everything. Use the `_photoBrief` text in `cases.json` as the prompt for an image model. Suggested: **Vertex AI Imagen** on the GCP credits (one batch job, ~22 images), or any image generator you have. Rules:
- No people, no faces, no license plates, no real agency logos or brand names.
- `C-009` must reuse the exact file `photos/C-003-house-windows.jpg` (this is how the duplicate detector is demonstrated).
- Bulk pool images must all be different (dedupe compares perceptual hashes).
- Save as JPEG ≤ 1024px on the long side; the app resizes anyway, but smaller uploads keep the seed fast.

Until the images exist, `pnpm seed --placeholders` writes labeled gray images for every photo still missing from `seed/photos/`, so the pipeline can be exercised with a partial set; cases that rely on placeholders get `needs_info` decisions. Each placeholder carries a block pattern derived from its file name, so different files hash apart and only C-009 (which reuses C-003's file) is flagged `duplicate_photo_hash`. Only generated photos exercise the real decision path.

`pnpm seed` checks the photos before it writes anything: every listed file must exist, and two different files used by different cases must not look alike to the duplicate detector (dHash distance ≤ 6), or it stops and names the pair.

## Running
```bash
cp seed/accounts.example.json seed/accounts.json   # fill in sandbox emails
pnpm seed            # creates the fund (raised = 0), 10 cases, 12 bulk cases, uploads photos
# Now donate on /donate as DONOR: at least $2,750 if every eligible case should be paid (e.g. $3,000).
# The seed script cannot do this: an Orders v2 capture needs the buyer's approval in a browser,
# and the ledger must never show a donation that was not a real sandbox capture.
pnpm agent:sweep     # lets the Case Officer process everything
pnpm seed --reset    # wipes Firestore collections + GCS prefix for this fund and reseeds (donate again afterwards)
```

Without `--reset`, `pnpm seed` refuses when any seed case id already exists, and an existing fund keeps its totals (only name, currency and policy version are updated). `--reset` deletes every document in `cases`, `donations`, `payouts`, `audit_log`, `agent_runs`, `webhook_events` and `auto_approvals`, the `fund/<FUND_ID>` document and every object under `gs://<GCS_BUCKET>/cases/`. It refuses while a case is `paying` or a payout is still pending at PayPal, because the ledger would lose track of that money; `--force` overrides. Seeding never wakes the agent: run `pnpm agent:sweep` after donating.

Expected after `agent:sweep` with ≥ $2,750 raised: C-001, C-002, C-006 and the 8 `tier2_clean` bulk cases → `paid` (11 × $250 = $2,750); C-003, C-004, C-005, C-009, C-010 and the 4 `tier3_displaced` bulk cases → `needs_review`; C-007, C-008 → `needs_info`. With less raised, eligible cases beyond the balance → `parked` (first-come) and are paid on the next donation. `tests/seed.test.ts` asserts these against `_expected`.

Share paid without a human once the operator approves the six-row batch: 11 of 17 (65%).

## Demo state (the arithmetic behind the demo video)
1. `pnpm seed --demo`, resets and seeds everything **except** C-001 (submitted live on camera).
2. Donate **$4,500 in total** on `/donate` as DONOR (e.g. $3,000 + $1,500).
3. `pnpm agent:sweep` → C-002, C-006 and the 8 bulk tier-2 cases are paid (10 × $250 = $2,500). **Balance: $2,000.**
4. On camera, C-001 auto-pays → **$1,750.**
5. On camera, the operator approves six rows: C-004 ($550), C-003 ($350), 4 bulk tier-3 ($350 each) = $2,300. P-8 pays tier-descending, then first-come: C-004 → $1,200 · C-003 → $850 · bulk tier-3 #1 → $500 · #2 → $150 · **#3 and #4 park.**
6. On camera, DONOR gives **$700** → $850 → the agent pays #3 and #4 (`create_payout ×2`) → $150 left.

Change any amount and the two live scenes ("some rows park", "the donation pays exactly two") stop lining up. Redo this arithmetic if the policy tiers, the household adjustment or the bulk counts change.
