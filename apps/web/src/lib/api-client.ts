export type ApiOk<T> = { ok: true; status: number; data: T };
export type ApiFail = {
  ok: false;
  /** HTTP status; 0 when the request never got a response. */
  status: number;
  code: string;
  message: string;
  details?: unknown;
  /** Seconds, from the Retry-After header. */
  retryAfter?: number;
};
export type ApiResult<T> = ApiOk<T> | ApiFail;

export type ApiInit = Omit<RequestInit, "body"> & {
  /** Sent as the JSON body, with the content-type header. */
  json?: unknown;
};

/** Seconds from a Retry-After header (the delta-seconds form); undefined if absent or invalid. */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : undefined;
}

/** Turns a Response into an ApiResult. Pure apart from reading the body, so tests can feed it. */
export async function toApiResult<T>(res: Response): Promise<ApiResult<T>> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // An empty or non-JSON body is fine for a success; errors fall back below.
  }
  if (res.ok) return { ok: true, status: res.status, data: body as T };
  const error = (body as { error?: Record<string, unknown> } | null)?.error;
  return {
    ok: false,
    status: res.status,
    code: typeof error?.code === "string" ? error.code : "INTERNAL",
    message: typeof error?.message === "string" ? error.message : "",
    ...(error?.details === undefined ? {} : { details: error.details }),
    retryAfter: parseRetryAfter(res.headers.get("Retry-After")),
  };
}

/**
 * fetch for `/api/v1`: JSON in and out, never throws. A network failure is `status: 0, code:
 * "NETWORK"`. A 401 sends the browser to the login page and still returns the error.
 */
export async function apiFetch<T>(
  url: string,
  init: ApiInit = {},
): Promise<ApiResult<T>> {
  const { json, headers, ...rest } = init;
  const finalHeaders = new Headers(headers);
  if (json !== undefined) finalHeaders.set("content-type", "application/json");
  let result: ApiResult<T>;
  try {
    const res = await fetch(url, {
      ...rest,
      headers: finalHeaders,
      body: json === undefined ? undefined : JSON.stringify(json),
      cache: "no-store",
    });
    result = await toApiResult<T>(res);
  } catch {
    return { ok: false, status: 0, code: "NETWORK", message: "" };
  }
  if (!result.ok && result.status === 401 && typeof window !== "undefined") {
    const here = window.location.pathname + window.location.search;
    // A full navigation on purpose: it drops all client state of the ended session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/login?next=${encodeURIComponent(here)}`);
  }
  return result;
}
