export function normalizeText(value: unknown): string | null {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

export function redactPersonalText(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[redacted]');
}

export function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = normalizeText(value)?.replace(/,/g, '');
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function boolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function dateOrNull(value: unknown): string | null {
  if (typeof value === 'number' && value > 0) return new Date(value).toISOString();
  const text = normalizeText(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

export function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const text = normalizeText(value);
    if (text) seen.add(text);
  }
  return [...seen];
}

export async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchJson<T>(url: string, options: RequestInit = {}, retries = 3): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          accept: 'application/json',
          ...(options.headers ?? {}),
        },
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
      return JSON.parse(text) as T;
    } catch (error) {
      lastError = error as Error;
      if (attempt < retries) await delay(500 * attempt);
    }
  }
  throw lastError ?? new Error(`Failed to fetch ${url}`);
}
