import gplayDefault from 'google-play-scraper';
import type {
  AppRecord,
  GooglePlayClient,
  RatingHistogram,
  SourceJobOutcome,
  SourceJobResult,
} from './types.js';
import {
  boundedNumberOrNull,
  dateOrNull,
  delay,
  nonNegativeIntegerOrNull,
  normalizeText,
  redactPersonalText,
  safeErrorMessage,
  truncateText,
  uniqueStrings,
} from './utils.js';

const gplay = ((gplayDefault as unknown as { app?: unknown }).app
  ? gplayDefault
  : (gplayDefault as unknown as { default: GooglePlayClient }).default) as unknown as GooglePlayClient;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_SCREENSHOTS = 20;
const GOOGLE_THROTTLE = 4;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function statusOf(error: unknown): number | null {
  if (!isObject(error)) return null;
  if (typeof error.status === 'number') return error.status;
  if (typeof error.statusCode === 'number') return error.statusCode;
  if (isObject(error.response)) {
    if (typeof error.response.status === 'number') return error.response.status;
    if (typeof error.response.statusCode === 'number') return error.response.statusCode;
  }
  const match = safeErrorMessage(error).match(/\b(408|425|429|500|502|503|504)\b/);
  return match?.[1] ? Number(match[1]) : null;
}

export function isGoogleNotFoundError(error: unknown): boolean {
  return statusOf(error) === 404 || /app not found\s*\(404\)/i.test(safeErrorMessage(error));
}

export function isRetryableGoogleError(error: unknown): boolean {
  const status = statusOf(error);
  if (status !== null) return RETRYABLE_STATUSES.has(status);
  return /(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket|network|timeout)/i
    .test(safeErrorMessage(error));
}

export async function retryGoogle<T>(
  operation: () => Promise<T>,
  attempts = 3,
  sleep: typeof delay = delay,
): Promise<T> {
  const maximumAttempts = Math.min(Math.max(attempts, 1), 3);
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      if (attempt >= maximumAttempts || !isRetryableGoogleError(error)) break;
      await sleep(650 * 2 ** (attempt - 1));
    }
  }
  throw lastError ?? new Error('Google Play request failed.');
}

function normalizeHistogram(value: unknown): RatingHistogram | null {
  if (!isObject(value)) return null;
  const oneStar = nonNegativeIntegerOrNull(value['1'] ?? value.oneStar ?? value.one);
  const twoStar = nonNegativeIntegerOrNull(value['2'] ?? value.twoStar ?? value.two);
  const threeStar = nonNegativeIntegerOrNull(value['3'] ?? value.threeStar ?? value.three);
  const fourStar = nonNegativeIntegerOrNull(value['4'] ?? value.fourStar ?? value.four);
  const fiveStar = nonNegativeIntegerOrNull(value['5'] ?? value.fiveStar ?? value.five);
  return [oneStar, twoStar, threeStar, fourStar, fiveStar].some((item) => item !== null)
    ? { oneStar, twoStar, threeStar, fourStar, fiveStar }
    : null;
}

function currencyOrNull(value: unknown): string | null {
  const currency = normalizeText(value)?.toUpperCase() ?? null;
  return currency && /^[A-Z]{3}$/.test(currency) ? currency : null;
}

export function mapGoogleApp(
  value: unknown,
  country: string,
  language: string,
  query: string | null,
  includeRatingsSummary: boolean,
  scrapedAt = new Date(),
): AppRecord | null {
  if (!isObject(value)) return null;
  const appId = normalizeText(value.appId);
  const appName = truncateText(redactPersonalText(value.title), 500);
  if (!appId || !appName) return null;
  const suppliedUrl = normalizeText(value.url);
  const appUrl = suppliedUrl ?? `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}`;
  const screenshotValues = Array.isArray(value.screenshots) ? value.screenshots : [];

  return {
    source: 'google_play',
    query,
    recordKey: `google_play:${appId}`,
    appId,
    bundleId: appId,
    appName,
    developer: truncateText(redactPersonalText(value.developer), 500),
    category: truncateText(redactPersonalText(value.genre), 200),
    price: boundedNumberOrNull(value.price, 0, 1_000_000_000),
    currency: currencyOrNull(value.currency),
    ratingValue: includeRatingsSummary ? boundedNumberOrNull(value.score, 0, 5) : null,
    ratingCount: includeRatingsSummary ? nonNegativeIntegerOrNull(value.ratings) : null,
    ratingHistogram: includeRatingsSummary
      ? normalizeHistogram(value.histogram ?? value.ratingHistogram ?? value.ratingsHistogram)
      : null,
    installRange: truncateText(value.installs, 100),
    version: truncateText(value.version, 100),
    contentRating: truncateText(value.contentRating, 100),
    releaseDate: dateOrNull(value.released),
    lastUpdated: dateOrNull(value.updated),
    description: truncateText(redactPersonalText(value.description ?? value.summary), 20_000),
    iconUrl: normalizeText(value.icon),
    screenshots: uniqueStrings(screenshotValues).slice(0, MAX_SCREENSHOTS),
    appUrl,
    country,
    language,
    scrapedAt: scrapedAt.toISOString(),
  };
}

function outcomeForRequests(successfulRequests: number, failedRequests: number): SourceJobOutcome {
  if (failedRequests > 0 && successfulRequests === 0) return 'failed';
  if (failedRequests > 0) return 'partial';
  return 'success';
}

export async function lookupGooglePlay(
  rawPackageNames: string[],
  maxRecords: number,
  country: string,
  language: string,
  includeRatingsSummary: boolean,
  requestOptions: Record<string, unknown>,
  query: string | null = null,
  client: GooglePlayClient = gplay,
): Promise<SourceJobResult> {
  const records: AppRecord[] = [];
  const warnings: string[] = [];
  let successfulRequests = 0;
  let failedRequests = 0;
  const attemptLimit = Math.min(200, Math.max(maxRecords * 2, 10));
  const packageNames = uniqueStrings(rawPackageNames).slice(0, attemptLimit);

  for (const appId of packageNames) {
    if (records.length >= maxRecords) break;
    try {
      const app = await retryGoogle(() => client.app({
        appId,
        country,
        lang: language,
        throttle: GOOGLE_THROTTLE,
        requestOptions,
      }));
      const record = mapGoogleApp(app, country, language, query, includeRatingsSummary);
      if (!record) {
        failedRequests += 1;
        warnings.push(`Google Play parser returned incomplete app metadata for ${appId}.`);
        continue;
      }
      successfulRequests += 1;
      records.push(record);
    } catch (error) {
      if (isGoogleNotFoundError(error)) {
        successfulRequests += 1;
        continue;
      }
      failedRequests += 1;
      warnings.push(`Google Play lookup failed for ${appId}: ${safeErrorMessage(error)}`);
    }
  }

  return {
    records,
    warnings,
    outcome: outcomeForRequests(successfulRequests, failedRequests),
  };
}

export async function searchGooglePlay(
  query: string,
  maxRecords: number,
  country: string,
  language: string,
  includeRatingsSummary: boolean,
  requestOptions: Record<string, unknown>,
  client: GooglePlayClient = gplay,
): Promise<SourceJobResult> {
  const value = await retryGoogle(() => client.search({
    term: query,
    num: Math.min(Math.max(maxRecords, 1), 100),
    country,
    lang: language,
    throttle: GOOGLE_THROTTLE,
    requestOptions,
  }));
  if (!Array.isArray(value)) throw new Error('Google Play search returned an unexpected response shape.');
  const ids = uniqueStrings(value.map((item) => (isObject(item) ? item.appId : null))).slice(0, maxRecords);
  if (value.length > 0 && ids.length === 0) {
    throw new Error('Google Play search parser returned rows without package IDs.');
  }
  if (!ids.length) return { records: [], warnings: [], outcome: 'success' };
  return lookupGooglePlay(
    ids,
    maxRecords,
    country,
    language,
    includeRatingsSummary,
    requestOptions,
    query,
    client,
  );
}
