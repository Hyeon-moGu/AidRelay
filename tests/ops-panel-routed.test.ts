// The case panel's "Sent to a volunteer" line (app/ops/case-panel.tsx, routedBecause) must name what actually sent
// the case to the queue. A payout that failed (system) or a volunteer's reopen (human) also lands a case in
// needs_review; the agent's older evaluation reason ("all auto-approve conditions hold") must not be shown as why.
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Decision } from "@/lib/agent/schema";
import type { CaseDetail } from "@/lib/ops/rows";

(globalThis as { React?: unknown }).React = React; // the app compiles JSX with the classic runtime under vitest
const { CasePanel } = await import("@/app/ops/case-panel");

const decision: Decision = {
  eligibility: "eligible",
  tier: 2,
  recommendedAmountCents: 25_000,
  confidence: 0.92,
  reasons: [{ clause: "P-3", evidence: "Photo 1: standing water" }],
  redFlags: [],
  followUpQuestions: [],
  applicantLanguage: "en",
  ledgerSummary: "Kitchen flooded; household of 3",
};

function detail(audit: CaseDetail["audit"]): CaseDetail {
  return {
    case: {
      id: "C-1",
      status: "needs_review",
      lang: "en",
      zip: "28501",
      householdSize: 3,
      requestedAmountCents: 25_000,
      narrative: "Water in the kitchen.",
      contact: null,
      tier: 2,
      aiDecision: decision,
      humanDecision: null,
      applicantMessage: null,
      notes: [],
      timestamps: { created: "2026-11-09T10:00:00.000Z" },
      photoUrls: [],
      docUrls: [],
    },
    payout: null,
    audit,
  } as CaseDetail;
}

const routedLine = (html: string) => /Sent to a volunteer.*?<\/p>/s.exec(html)?.[0] ?? "";

describe("Sent to a volunteer", () => {
  it("shows the code's reason after an agent escalation", () => {
    const html = renderToStaticMarkup(
      createElement(CasePanel, {
        detail: detail([{ actor: "agent", action: "case.evaluated", policyClause: "P-9.3", reason: "$350 is above the $250 auto-approve limit", ts: "2026-11-09T10:01:00.000Z" }] as CaseDetail["audit"]),
        onClose: () => {},
      }),
    );
    expect(routedLine(html)).toContain("auto-approve limit");
  });

  it("does not present an old 'all conditions hold' verdict as the reason after the payout failed", () => {
    const html = renderToStaticMarkup(
      createElement(CasePanel, {
        detail: detail([
          { actor: "system", action: "payout.failed", policyClause: "P-9", reason: "payout RETURNED; a human must re-issue or contact the applicant", ts: "2026-11-09T11:00:00.000Z" },
          { actor: "agent", action: "case.evaluated", policyClause: "P-9", reason: "all auto-approve conditions hold", ts: "2026-11-09T10:01:00.000Z" },
        ] as CaseDetail["audit"]),
        onClose: () => {},
      }),
    );
    expect(routedLine(html)).not.toContain("all auto-approve conditions hold");
  });

  it("does not present the agent's verdict as the reason after a volunteer reopened the case", () => {
    const html = renderToStaticMarkup(
      createElement(CasePanel, {
        detail: detail([
          { actor: "human:ops", action: "case.human_reopened", reason: "reopened by operator", ts: "2026-11-09T11:00:00.000Z" },
          { actor: "agent", action: "case.evaluated", policyClause: "P-8", reason: "the balance does not reach this case in policy order; paid when a donation covers it", ts: "2026-11-09T10:01:00.000Z" },
        ] as CaseDetail["audit"]),
        onClose: () => {},
      }),
    );
    expect(routedLine(html)).not.toContain("the balance does not reach this case");
  });

  it("does not present a payout bookkeeping entry as the reason when the trail carries no statuses", () => {
    const html = renderToStaticMarkup(
      createElement(CasePanel, {
        detail: detail([
          { actor: "system", action: "payout.event_ignored", reason: "event for another batch", ts: "2026-11-09T11:00:00.000Z" },
          { actor: "agent", action: "case.evaluated", policyClause: "P-4", reason: "red flags: duplicate_photo_hash (P-4)", ts: "2026-11-09T10:01:00.000Z" },
        ] as CaseDetail["audit"]),
        onClose: () => {},
      }),
    );
    expect(routedLine(html)).toContain("duplicate_photo_hash");
    expect(routedLine(html)).not.toContain("another batch");
  });
});
