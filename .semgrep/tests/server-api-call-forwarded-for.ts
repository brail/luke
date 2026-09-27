declare function buildApiUrl(path: string): string;
declare function buildTrpcUrl(procedure: string): string;
declare function getApiBaseUrl(): string;
declare function forwardedFor(headers: { get(name: string): string | null }): Record<string, string>;
declare function httpBatchLink(opts: unknown): unknown;
declare function httpBatchStreamLink(opts: unknown): unknown;
declare const utils: { config: { getMultiple: { fetch(input: unknown): Promise<unknown> } } };

type Incoming = { get(name: string): string | null };

export async function literalHeader(ip: string) {
  // ruleid: luke-server-api-call-forwarded-for
  return fetch(buildTrpcUrl('auth.login'), { method: 'POST', headers: { 'X-Forwarded-For': ip } });
}

export async function noOptions() {
  // ruleid: luke-server-api-call-forwarded-for
  return fetch(buildApiUrl('/uploads/a'));
}

export async function urlFromBase() {
  const url = `${getApiBaseUrl()}/trpc/x`;
  // ruleid: luke-server-api-call-forwarded-for
  return fetch(url, { method: 'GET' });
}

export async function urlFromEnv() {
  // ruleid: luke-server-api-call-forwarded-for
  return fetch(`${process.env.INTERNAL_API_URL}/trpc/x`, { method: 'GET' });
}

export async function optionsBuiltOutside(h: Incoming) {
  const options = { headers: forwardedFor(h) };
  // ruleid: luke-server-api-call-forwarded-for
  return fetch(buildApiUrl('/a'), options);
}

export async function onlyInTheBody() {
  // ruleid: luke-server-api-call-forwarded-for
  return fetch(buildApiUrl('/a'), { method: 'POST', body: 'forwardedFor(' });
}

export async function unusedHelper(h: Incoming) {
  const unused = forwardedFor(h);
  // ruleid: luke-server-api-call-forwarded-for
  const res = await fetch(buildApiUrl('/a'), { headers: {} });
  return [unused, res];
}

export async function wrongPlace(h: Incoming) {
  // ruleid: luke-server-api-call-forwarded-for
  return fetch(buildApiUrl('/a'), { headers: {}, body: JSON.stringify(forwardedFor(h)) });
}

export function linkWithout(token: string) {
  // ruleid: luke-server-api-call-forwarded-for
  return httpBatchLink({ url: buildApiUrl('/trpc'), headers: () => ({ Authorization: `Bearer ${token}` }) });
}

export async function headersIsTheHelper(req: { headers: Incoming }) {
  // ok: luke-server-api-call-forwarded-for
  return fetch(buildApiUrl('/uploads/a'), { method: 'GET', headers: forwardedFor(req.headers) });
}

export async function spreadIntoHeaders(h: Incoming, token: string) {
  // ok: luke-server-api-call-forwarded-for
  const response = await fetch(buildTrpcUrl('auth.refreshToken'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...forwardedFor(h),
    },
    body: JSON.stringify({}),
  });
  return response;
}

export function linkWith(token: string, h: Incoming) {
  // ok: luke-server-api-call-forwarded-for
  return httpBatchStreamLink({
    url: buildApiUrl('/trpc'),
    headers: () => ({ Authorization: `Bearer ${token}`, ...forwardedFor(h) }),
  });
}

export async function memberFetch() {
  // ok: luke-server-api-call-forwarded-for
  return utils.config.getMultiple.fetch({ keys: [] });
}

// Stands in for a file-level `'use client'` directive, which matches the same
// `'use client'; ...` guard: `semgrep --test` cannot hold a second fixture file
// with no finding. The file-level case is proven on apps/web/src, whose client
// fetch sites all carry the directive.
export async function browserUpload(body: FormData) {
  'use client';
  // ok: luke-server-api-call-forwarded-for
  return fetch(buildApiUrl('/upload/a'), { method: 'POST', body, credentials: 'include' });
}
