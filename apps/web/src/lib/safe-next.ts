/**
 * Where to send the user after login. Only same-site paths are allowed, so a crafted
 * `?next=https://evil.example` (or `//evil.example`, `/\\evil.example`, `/.//evil.example`)
 * can't redirect off-site. The checks run on the normalised result, because the URL parser
 * collapses dot segments (`/.//x` → `//x`) after any check on the raw input.
 */
export function safeNextPath(
  value: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (!value || !value.startsWith("/")) return fallback;
  const base = "http://same-site.invalid";
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return fallback;
  }
  if (url.origin !== base) return fallback;
  const path = `${url.pathname}${url.search}${url.hash}`;
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return fallback;
  }
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    decoded.startsWith("//") ||
    decoded.includes("\\")
  ) {
    return fallback;
  }
  return path;
}
