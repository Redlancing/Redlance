/**
 * Where to send the user after login. Only same-site paths are allowed, so a crafted
 * `?next=https://evil.example` (or `//evil.example`, `/\evil.example`) can't redirect off-site.
 */
export function safeNextPath(
  value: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (!value || !value.startsWith("/") || value.startsWith("//"))
    return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  if (decoded.startsWith("//") || decoded.includes("\\")) return fallback;
  const base = "http://same-site.invalid";
  const url = new URL(value, base);
  if (url.origin !== base) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
