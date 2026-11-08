// pnpm seed [--reset] [--demo] [--placeholders] [--force]
// Loads seed/cases.json + seed/photos into Firestore/GCS (sandbox). See seed/README.md.
//   (none)          create the fund (if missing) and the 22 seed cases; refuses if a seed case id exists
//   --reset         first wipe the case collections, the fund document FUND_ID and gs://GCS_BUCKET/cases/
//   --demo          --reset, then seed everything except C-001 (submitted live on camera)
//   --placeholders  labeled gray images for the photos still missing from seed/photos (those cases get needs_info)
//   --force         reset even while a payout is in flight (it loses track of that money)
// Donations are never seeded: an Orders v2 capture needs the donor's approval in a browser.
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FundDoc } from "@/lib/db/types";

try {
  process.loadEnvFile();
} catch {
  // rely on the environment when there is no .env
}

const SEED_DIR = path.join(process.cwd(), "seed");
const FLAGS = ["--reset", "--demo", "--placeholders", "--force"] as const;
type Flag = (typeof FLAGS)[number];

function parseFlags(argv: string[]): Set<Flag> {
  const unknown = argv.filter((a) => !(FLAGS as readonly string[]).includes(a));
  if (unknown.length) throw new Error(`unknown flag(s): ${unknown.join(" ")}. Known: ${FLAGS.join(" ")}`);
  return new Set(argv as Flag[]);
}

function readJson(file: string, hint: string): unknown {
  const p = path.join(SEED_DIR, file);
  if (!existsSync(p)) throw new Error(`seed/${file} is missing. ${hint}`);
  return JSON.parse(readFileSync(p, "utf8"));
}

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const demo = flags.has("--demo");
  const reset = demo || flags.has("--reset");
  const placeholders = flags.has("--placeholders");

  const { buildSeedPlan, nearDuplicateImages, resetBlockers } = await import("@/lib/seed/plan");
  const { placeholderImage } = await import("@/lib/seed/placeholder");
  const { imageHash } = await import("@/lib/dedupe/phash");
  const { CASES_PREFIX, caseDocPath, casePhotoPath, deletePrefix, prepareImageForStorage, uploadObject } = await import("@/lib/storage/gcs");
  const { col, getDb } = await import("@/lib/db/firestore");
  const { createCase } = await import("@/lib/db/repos/cases");
  const { fundRef } = await import("@/lib/db/repos/fund");
  const { getEnv } = await import("@/lib/env");
  const { Timestamp } = await import("firebase-admin/firestore");

  // 1. Everything that can fail without a service: data, accounts, image files.
  const plan = buildSeedPlan(
    readJson("cases.json", "It ships with the repository."),
    readJson("accounts.json", "Copy seed/accounts.example.json to seed/accounts.json and fill in the sandbox account emails."),
    { demo },
  );

  const usedBy = new Map<string, string[]>();
  for (const c of plan.cases) for (const p of new Set([...c.photos, ...c.docs])) usedBy.set(p, [...(usedBy.get(p) ?? []), c.id]);

  const missing = new Set([...usedBy.keys()].filter((p) => !existsSync(path.join(SEED_DIR, p))));
  if (missing.size && !placeholders) {
    throw new Error(
      `${missing.size} seed image(s) missing under seed/:\n  ${[...missing].join("\n  ")}\n` +
        "Generate them from the _photoBrief text in seed/cases.json (seed/README.md), or add --placeholders to fill the missing ones with gray placeholders.",
    );
  }

  console.log(`preparing ${usedBy.size} images: ${usedBy.size - missing.size} from seed/photos, ${missing.size} placeholders …`);
  const images = new Map<string, { jpeg: Buffer; hash: string }>();
  for (const p of usedBy.keys()) {
    const source = missing.has(p) ? await placeholderImage(p) : await readFile(path.join(SEED_DIR, p));
    const jpeg = await prepareImageForStorage(source);
    images.set(p, { jpeg, hash: await imageHash(jpeg) });
  }
  const lookalikes = nearDuplicateImages([...images].map(([p, v]) => ({ path: p, hash: v.hash, caseIds: usedBy.get(p)! })));
  if (lookalikes.length) throw new Error(`images the duplicate detector cannot tell apart:\n  ${lookalikes.join("\n  ")}`);

  // 2. Firestore and GCS.
  const env = getEnv();
  const db = getDb();
  if (plan.fund.id !== env.FUND_ID) console.warn(`note: cases.json names fund "${plan.fund.id}", writing to FUND_ID "${env.FUND_ID}" from the environment`);

  if (reset) {
    const [paying, pending] = await Promise.all([
      db.collection(col.cases).where("status", "==", "paying").get(),
      db.collection(col.payouts).where("outcome", "==", "pending").get(),
    ]);
    const blockers = resetBlockers(
      paying.docs.map((d) => ({ id: d.id, status: String(d.get("status")) })),
      pending.docs.map((d) => ({ caseId: d.id, outcome: String(d.get("outcome")), status: String(d.get("status")) })),
    );
    if (blockers.length && !flags.has("--force")) {
      throw new Error(`reset refused, money is in flight:\n  ${blockers.join("\n  ")}\nWait for the payouts to settle (pnpm agent:sweep polls them), or pass --force.`);
    }
    const wiped: string[] = [];
    for (const name of [col.cases, col.donations, col.payouts, col.auditLog, col.agentRuns, col.webhookEvents, col.autoApprovals]) {
      const ref = db.collection(name);
      const n = (await ref.count().get()).data().count;
      if (n) await db.recursiveDelete(ref);
      wiped.push(`${name} ${n}`);
    }
    await fundRef().delete();
    const objects = await deletePrefix(CASES_PREFIX);
    console.log(`reset: deleted ${wiped.join(", ")}; fund/${env.FUND_ID}; ${objects} objects under gs://${env.GCS_BUCKET}/${CASES_PREFIX}`);
  } else {
    const snaps = await db.getAll(...plan.cases.map((c) => db.collection(col.cases).doc(c.id)));
    const existing = snaps.filter((s) => s.exists).map((s) => s.id);
    if (existing.length) throw new Error(`already seeded (${existing.join(", ")}). Run \`pnpm seed --reset\` to start over.`);
  }

  const fund = await db.runTransaction(async (tx) => {
    const ref = fundRef();
    const snap = await tx.get(ref);
    const now = Timestamp.now();
    const meta = { name: plan.fund.name, currency: plan.fund.currency, policyVersion: plan.fund.policyVersion, updatedAt: now };
    if (snap.exists) {
      // Kept, not zeroed: the totals come from real sandbox captures and payouts.
      tx.set(ref, meta, { merge: true });
      const cur = snap.data() as Partial<FundDoc>;
      return { raisedCents: cur.raisedCents ?? 0, paidCents: cur.paidCents ?? 0 };
    }
    tx.create(ref, { id: env.FUND_ID, ...meta, raisedCents: 0, paidCents: 0, reservedCents: 0, createdAt: now } satisfies FundDoc);
    return { raisedCents: 0, paidCents: 0 };
  });
  console.log(`fund ${env.FUND_ID}: "${plan.fund.name}", raised ${dollars(fund.raisedCents)}, paid ${dollars(fund.paidCents)}`);

  // Sequential on purpose: creation time is first-come order for P-8.
  let uploaded = 0;
  const created: Array<{ id: string; token: string; lang: string; source: string }> = [];
  for (const c of plan.cases) {
    const store = async (files: string[], pathFor: (i: number) => string) =>
      Promise.all(
        files.map(async (f, i) => {
          const img = images.get(f)!;
          const objectPath = pathFor(i + 1);
          await uploadObject(objectPath, img.jpeg, "image/jpeg");
          uploaded++;
          return { objectPath, hash: img.hash };
        }),
      );
    const photos = await store(c.photos, (i) => casePhotoPath(c.id, i));
    const docs = await store(c.docs, (i) => caseDocPath(c.id, i));
    const doc = await createCase({
      id: c.id,
      lang: c.lang,
      zip: c.zip,
      householdSize: c.householdSize,
      requestedAmountCents: c.requestedAmountCents,
      narrative: c.narrative,
      photos: photos.map((x) => x.objectPath),
      docs: docs.map((x) => x.objectPath),
      photoHashes: [...photos, ...docs].map((x) => x.hash),
      contact: { name: c.contact.name, email: c.contact.email.toLowerCase(), phone: c.contact.phone, address: c.contact.address },
    });
    created.push({ id: doc.id, token: doc.token, lang: doc.lang, source: c.template ?? "hand" });
    process.stdout.write(`  ${doc.id} ${doc.lang} ${(c.template ?? "hand-crafted").padEnd(16)} ${photos.length + docs.length} image(s)\n`);
  }

  const hand = created.filter((c) => c.source === "hand").length;
  console.log(`\ncreated ${created.length} cases (${hand} hand-crafted, ${created.length - hand} bulk), uploaded ${uploaded} images`);
  if (plan.skipped.length) console.log(`left out for the live scene: ${plan.skipped.join(", ")} (submit it on /apply?demo=${plan.skipped[0]})`);
  console.log("\nstatus pages (hand-crafted):");
  for (const c of created.filter((x) => x.source === "hand")) console.log(`  ${c.id} ${c.lang}  ${env.APP_URL}/status/${c.token}`);
  console.log(
    [
      "",
      "next:",
      demo
        ? "  1. donate $4,500 in total on /donate as DONOR (e.g. $3,000 + $1,500), see seed/README.md \"Demo state\""
        : "  1. donate on /donate as DONOR: at least $2,750 to pay every eligible case (e.g. $3,000)",
      "  2. pnpm agent:sweep",
      missing.size ? `  (${missing.size} placeholder image(s): cases that rely on them get needs_info decisions)` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(`\npnpm seed failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);

export {};
