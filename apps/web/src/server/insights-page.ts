import "server-only";
import { accessFromCode } from "@/lib/insights-view";
import { ApiError } from "./errors";
import { insightsViewer, type InsightsViewer } from "./insights";

export type InsightsAccess =
  | { access: "ok"; viewer: InsightsViewer }
  | { access: "locked" | "not_onboarded" };

/** The pages' version of the API's viewer check: locked and not onboarded become states. */
export async function insightsAccess(userId: string): Promise<InsightsAccess> {
  try {
    return { access: "ok", viewer: await insightsViewer(userId) };
  } catch (err) {
    const access = err instanceof ApiError ? accessFromCode(err.code) : null;
    if (access === "locked" || access === "not_onboarded") return { access };
    throw err;
  }
}
