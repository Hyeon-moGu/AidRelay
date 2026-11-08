"use client";

// The ledger auditor: the public ledger's AG Studio report in edit mode, with Studio's AI panel driven by
// AG Studio's Agent Framework on Claude. Our own "Ledger auditor" agent answers questions from the
// anonymized tables (view_schema, execute_query) and hands chart work to Studio's built-in page and widget
// agents through delegate_to. Every model turn goes through claudeAdapter to /api/ops/ask.
import { useMemo, useState } from "react";
import { AgStudio } from "ag-studio-react";
import {
  AgStudioAiModule,
  AgStudioLicenseManager,
  createAiHarness,
  directLlmRunner,
  type AgAiHarnessSetup,
  type AgAiPromptStarter,
  type AgStudioApi,
} from "ag-studio";
import { ledgerDataSources, ledgerReport, ledgerTheme, type LedgerStudioData } from "@/app/ledger/ledger-studio";
import { ledgerWidgets } from "@/app/ledger/studio-widgets";
import { claudeAdapter } from "./claude-adapter";

const PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: "Paid without a volunteer", prompt: "Which grants did the AI case officer approve without a volunteer, and how much did they total?" },
  { label: "Every payout has a PayPal id?", prompt: "Does every paid grant carry a PayPal payout id? List any that do not." },
  { label: "Amounts against the rules", prompt: "Check every grant's amount against the fund's grant levels and household rule, and list any that do not match." },
  { label: "Chart who said yes", prompt: "Add a chart of the total paid by level of need, split by who approved the grant." },
];

function auditorInstructions(policyFacts: string): string {
  return `You are the ledger auditor for AidRelay, a community disaster-relief fund. Volunteers ask you where the money went and whether the grants follow the fund's rules. You work only from this report's tables (Grants, Donations, Fund). They are anonymized: they hold no names, addresses or contact details, so never guess who a family is.

How you work:
- Compute every number you state with execute_query, passing "query" as a JSON object (not a string). Call view_schema first if you are unsure of a field. Never estimate or invent a figure.
- Cite your evidence: case ids (like C-012) and PayPal payout ids for grants, PayPal capture ids for donations.
- Answer in one or two plain sentences, then at most six short bullet lines of evidence. Money in dollars with the $ sign.
- When someone asks for a chart, work in this order:
  1. Query the numbers yourself first, so you know what the chart must show.
  2. Delegate to the page agent to add one widget of the right type below the existing widgets, without moving them. The call looks like {"type": {"id": "page", "pageId": "ledger"}, "instructions": "Add one column-chart-grouped widget with id paidByNeed below the existing widgets."}
  3. Delegate to the widget agent to map that widget's fields and give it a plain title. The call looks like {"type": {"id": "widget", "pageId": "ledger", "widgetId": "paidByNeed", "widgetType": "column-chart-grouped"}, "instructions": "Categories grants.need, series grants.decidedBy, value the sum of grants.paid, title ..."}
  4. Call view_widget on the new widget once to confirm it shows data, then answer in one sentence with the chart's title and the figures from step 1.
  Never ask the person to check the dashboard themselves.
- You cannot approve, pay or reject anything, and you cannot change the data. If asked, say that volunteers do that in the review queue at /ops.
- Plain English. Do not use em dashes.

The fund's rules, for checking grants:
${policyFacts}`;
}

let licensed = false;

export function AuditStudio({ ledger, licenseKey, policyFacts }: { ledger: LedgerStudioData; licenseKey: string; policyFacts: string }) {
  if (licenseKey && !licensed) {
    AgStudioLicenseManager.setLicenseKey(licenseKey);
    licensed = true;
  }
  const data = useMemo(() => ledgerDataSources(ledger), [ledger]);
  const [initialState] = useState(ledgerReport);

  const ai = useMemo<AgAiHarnessSetup>(() => {
    const adapter = claudeAdapter("/api/ops/ask");
    return ({ api }) =>
      createAiHarness(api as AgStudioApi, ({ builtIn, tools }) => ({
        agents: [
          directLlmRunner({
            id: "auditor",
            name: "Ledger auditor",
            description: "Answers questions about the fund's grants and donations from the ledger tables, and checks them against the fund's rules.",
            adapter,
            instructions: () => auditorInstructions(policyFacts),
            tools: (ctx) => [ctx.studio.viewSchema(), ctx.studio.executeQuery(), ctx.studio.viewReport(), ctx.studio.viewWidget(), tools.delegateTo(["data", "page", "widget"])],
            maxTurns: 16,
          }),
          // Studio's own agents, running on Claude through the same adapter.
          directLlmRunner({ ...builtIn.data, adapter }),
          directLlmRunner({ ...builtIn.page, adapter }),
          directLlmRunner({ ...builtIn.widget, adapter }),
        ],
        primary: "auditor",
        promptStarters: PROMPT_STARTERS,
      }));
  }, [policyFacts]);

  return (
    <AgStudio
      style={{ width: "100%", height: "100%" }}
      mode="edit"
      modules={[AgStudioAiModule]}
      ai={ai}
      theme={ledgerTheme}
      data={data}
      initialState={initialState}
      widgets={ledgerWidgets}
      panels={{ edit: { left: ["ai"], right: ["edit"] } }}
    />
  );
}
