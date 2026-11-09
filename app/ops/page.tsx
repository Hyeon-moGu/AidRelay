import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEnv } from "@/lib/env";
import { opsAccess } from "@/lib/ops/auth";
import { OpsConsole } from "./ops-console";

export const metadata: Metadata = { title: "Staff console · AidRelay" };
export const dynamic = "force-dynamic";

export default async function OpsPage() {
  const access = await opsAccess();
  if (access === "none") redirect("/ops/login");
  // The AG Grid licence key is meant for the browser; without one the grid still works, with a watermark.
  // A visitor of the open demo sees the same console; the server refuses every action without the operator session.
  return <OpsConsole licenseKey={getEnv().AG_GRID_LICENSE_KEY ?? ""} canAct={access === "operator"} />;
}
