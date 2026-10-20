import { safeNextPath } from "@/lib/safe-next";

/** Request header the proxy sets so layouts can build a `/login?next=` redirect. */
export const REQUEST_PATH_HEADER = "x-redlance-path";

/**
 * The query string of the requested URL, from the header above, for layouts (which are not
 * given `searchParams`). The proxy overwrites the header on every request, and the value goes
 * through `safeNextPath`; anything odd gives empty params, so callers fall back to defaults.
 */
export function searchParamsFromRequestPath(
  value: string | null | undefined,
): URLSearchParams {
  if (!value) return new URLSearchParams();
  try {
    return new URL(safeNextPath(value, "/"), "http://same-site.invalid")
      .searchParams;
  } catch {
    return new URLSearchParams();
  }
}
