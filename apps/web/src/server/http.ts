import "server-only";

export function json(
  status: number,
  body: unknown,
  headers?: HeadersInit,
): Response {
  return Response.json(body, { status, headers });
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1 || part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

const IP_RE = /^[0-9a-fA-F:.]{2,45}$/;

function validIp(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  return candidate && IP_RE.test(candidate) && /[.:]/.test(candidate)
    ? candidate
    : undefined;
}

/**
 * Client IP for per-IP limits, as seen by CloudFront. Prefers `CloudFront-Viewer-Address`
 * ("ip:port", set by CloudFront itself); otherwise the LAST `X-Forwarded-For` entry, since
 * CloudFront appends the viewer IP and every earlier entry is whatever the client sent.
 * Only trustworthy because the production server accepts traffic from CloudFront alone.
 */
export function clientIp(request: Request): string {
  const viewer = request.headers.get("cloudfront-viewer-address");
  if (viewer) {
    const colon = viewer.lastIndexOf(":");
    return validIp(colon > 0 ? viewer.slice(0, colon) : viewer) ?? "unknown";
  }
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return validIp(forwarded.split(",").at(-1)) ?? "unknown";
  return validIp(request.headers.get("x-real-ip") ?? undefined) ?? "unknown";
}
