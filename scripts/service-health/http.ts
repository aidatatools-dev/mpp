import { isIP } from "node:net";

export type Outcome = "pass" | "fail" | "inconclusive" | "skipped";
export interface Result {
  service: string;
  target: string;
  url: string;
  outcome: Outcome;
  reason: string;
  status?: number;
  attempts: number;
  finalUrl?: string;
}
export interface Probe {
  service: string;
  target: string;
  url: string;
  method: string;
  body?: string;
  skip?: string;
  followRedirects?: boolean;
}

export type Evaluate = (
  response: Response,
) => Pick<Result, "outcome" | "reason">;
export interface RequestOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}
export type ProbeRunner = (probe: Probe, evaluate: Evaluate) => Promise<Result>;

export function requestKey(url: string, method = "GET", body = ""): string {
  const normalized = new URL(url);
  normalized.hash = "";
  return JSON.stringify([method.toUpperCase(), normalized.href, body]);
}

/** Cache header observations, not verdicts: plugins can evaluate the same response differently. */
export function createProbeRunner(options: RequestOptions = {}): ProbeRunner {
  const cache = new Map<
    string,
    Promise<{ status: number; headers: Headers }>
  >();
  const cachedFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const key = requestKey(url, init?.method, String(init?.body ?? ""));
    let pending = cache.get(key);
    if (!pending) {
      pending = (async () => {
        const response = await (options.fetch ?? fetch)(input, init);
        try {
          return { headers: response.headers, status: response.status };
        } finally {
          await response.body?.cancel().catch(() => {});
        }
      })();
      cache.set(key, pending);
    }
    const snapshot = await pending;
    return new Response(null, snapshot);
  };
  return (probe, evaluate) =>
    checkProbe(probe, evaluate, { ...options, fetch: cachedFetch });
}

function validUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error(
      "Only HTTPS listing URLs without credentials are supported",
    );
  return url;
}

export async function checkProbe(
  probe: Probe,
  evaluate: Evaluate,
  options: RequestOptions = {},
): Promise<Result> {
  const base = { service: probe.service, target: probe.target, url: probe.url };
  if (probe.skip)
    return { ...base, attempts: 0, outcome: "skipped", reason: probe.skip };
  let url = validUrl(probe.url);
  const visited = new Set<string>();
  for (let redirects = 0; ; redirects++) {
    visited.add(url.href);
    const response = await (options.fetch ?? fetch)(url, {
      body: probe.body,
      credentials: "omit",
      headers: {
        ...(probe.body && { "Content-Type": "application/json" }),
        "User-Agent": "mpp-directory-health/1.0",
      },
      method: probe.method,
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    }).catch(() => undefined);
    if (!response)
      return {
        ...base,
        attempts: 1,
        outcome: "inconclusive",
        reason: "Network, TLS, or timeout failure; availability unverified",
      };
    try {
      const redirected = [301, 302, 303, 307, 308].includes(response.status);
      if (
        redirected &&
        probe.followRedirects &&
        ["GET", "HEAD"].includes(probe.method)
      ) {
        const location = response.headers.get("location");
        let next: URL | undefined;
        try {
          if (location) next = validUrl(new URL(location, url).href);
        } catch {
          /* Report invalid redirects without following them. */
        }
        if (
          !next ||
          redirects >= 3 ||
          visited.has(next.href) ||
          next.hostname === "localhost" ||
          !next.hostname.includes(".") ||
          isIP(next.hostname.replace(/^\[|\]$/g, "")) !== 0 ||
          /\.(localhost|local|internal)$/.test(next.hostname)
        )
          return {
            ...base,
            attempts: 1,
            outcome: "inconclusive",
            reason:
              "Redirect is invalid, unsafe, cyclic, or exceeds three hops",
            status: response.status,
          };
        url = next;
        continue;
      }
      return {
        ...base,
        ...evaluate(response),
        attempts: 1,
        finalUrl: url.href,
        status: response.status,
      };
    } finally {
      await response.body?.cancel().catch(() => {});
    }
  }
}
