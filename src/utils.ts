const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const MAX_RETRY_DELAY_MS = 30_000;
const hostNextRequestAt = new Map<string, number>();

export function normalizeText(value: unknown): string | null {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

export function truncateText(value: unknown, maximumLength: number): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  return text.length <= maximumLength ? text : `${text.slice(0, maximumLength - 3)}...`;
}

export function redactPersonalText(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[redacted phone]');
}

export function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = normalizeText(value)?.replace(/,/g, '');
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function boundedNumberOrNull(value: unknown, minimum: number, maximum: number): number | null {
  const parsed = numberOrNull(value);
  return parsed !== null && parsed >= minimum && parsed <= maximum ? parsed : null;
}

export function nonNegativeIntegerOrNull(value: unknown): number | null {
  const parsed = numberOrNull(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function dateOrNull(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const text = normalizeText(value);
  if (!text) return null;
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      return null;
    }
    return date.toISOString();
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = normalizeText(value);
    if (!text) continue;
    const key = text.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/[^\s/@:]+:[^\s/@]+@/gi, 'https://[redacted]@')
    .replace(/([?&](?:term|bundleId|id)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 500);
}

export async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterMs: number | null,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function minimumRequestIntervalMs(url: string): number {
  return new URL(url).hostname.toLowerCase() === 'itunes.apple.com' ? 3000 : 0;
}

async function waitForHostSlot(url: string): Promise<void> {
  const intervalMs = minimumRequestIntervalMs(url);
  if (!intervalMs) return;
  const hostname = new URL(url).hostname.toLowerCase();
  const now = Date.now();
  const nextAllowedAt = hostNextRequestAt.get(hostname) ?? now;
  if (nextAllowedAt > now) await delay(nextAllowedAt - now);
  hostNextRequestAt.set(hostname, Math.max(nextAllowedAt, Date.now()) + intervalMs);
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return Math.min(Math.max(timestamp - Date.now(), 0), MAX_RETRY_DELAY_MS);
}

function isRetryableHttpError(error: unknown): boolean {
  return !(error instanceof HttpError) || RETRYABLE_HTTP_STATUSES.has(error.status);
}

export interface FetchJsonOptions {
  retries?: number;
  timeoutMs?: number;
  pace?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: typeof delay;
}

export async function fetchJson<T>(
  url: string,
  options: RequestInit = {},
  fetchOptions: FetchJsonOptions = {},
): Promise<T> {
  const attempts = Math.min(Math.max(fetchOptions.retries ?? 3, 1), 5);
  const timeoutMs = Math.min(Math.max(fetchOptions.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, 1000), 60_000);
  const fetchImpl = fetchOptions.fetchImpl ?? fetch;
  const sleep = fetchOptions.sleep ?? delay;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (fetchOptions.pace !== false) await waitForHostSlot(url);
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
      const response = await fetchImpl(url, {
        ...options,
        signal,
        headers: { accept: 'application/json', ...(options.headers ?? {}) },
      });
      const text = await response.text();
      if (!response.ok) {
        throw new HttpError(
          `${response.status} ${response.statusText}: ${text.slice(0, 300)}`,
          response.status,
          parseRetryAfter(response.headers.get('retry-after')),
        );
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new HttpError('Apple API returned invalid JSON.', 200, null);
      }
    } catch (error) {
      lastError = error as Error;
      if (attempt >= attempts || !isRetryableHttpError(error)) break;
      const retryAfterMs = error instanceof HttpError ? error.retryAfterMs : null;
      await sleep(retryAfterMs ?? Math.min(650 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS));
    }
  }

  throw lastError ?? new Error('Apple API request failed.');
}
