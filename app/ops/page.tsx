import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEnv } from "@/lib/env";
import { isOperator } from "@/lib/ops/auth";
import { OpsConsole } from "./ops-console";

export const metadata: Metadata = { title: "Operator console · AidRelay" };
export const dynamic = "force-dynamic";

export default async function OpsPage() {
  if (!(await isOperator())) redirect("/ops/login");
  // The AG Grid licence key is meant for the browser; without one the grid still works, with a watermark.
  return <OpsConsole licenseKey={getEnv().AG_GRID_LICENSE_KEY ?? ""} />;
}
