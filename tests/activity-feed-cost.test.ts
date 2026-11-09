// The activity feed's cost line (app/ops/activity-feed.tsx). "Settled in code, no model call" is right for a payout
// update; it is wrong for a run that failed, where a model call may have been attempted and nothing was settled.
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OpsRun } from "@/lib/ops/rows";

(globalThis as { React?: unknown }).React = React; // the app compiles JSX with the classic runtime under vitest
const { ActivityFeed } = await import("@/app/ops/activity-feed");

const run = (patch: Partial<OpsRun>): OpsRun =>
  ({
    id: "r1",
    trigger: "payout.webhook",
    caseId: "C-1",
    status: "done",
    summary: "C-1 is paid.",
    cost: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, modelCalls: 0 },
    ts: "2026-11-09T10:00:00.000Z",
    finishedAt: "2026-11-09T10:00:01.000Z",
    toolCalls: [],
    ...patch,
  }) as OpsRun;

describe("activity feed cost line", () => {
  it("a payout update settled in code says so", () => {
    expect(renderToStaticMarkup(createElement(ActivityFeed, { runs: [run({})] }))).toContain("Settled in code, no model call");
  });
  it("counts model calls when there were some", () => {
    const html = renderToStaticMarkup(createElement(ActivityFeed, { runs: [run({ trigger: "case.created", cost: { inputTokens: 1200, outputTokens: 300, cachedInputTokens: 0, modelCalls: 4 } })] }));
    expect(html).toContain("4 model calls");
  });
  it("a failed run (the model call itself failed) is not described as settled in code", () => {
    const html = renderToStaticMarkup(createElement(ActivityFeed, { runs: [run({ trigger: "case.created", status: "error", summary: "Run failed: 529 overloaded" })] }));
    expect(html).not.toContain("Settled in code");
  });
});
