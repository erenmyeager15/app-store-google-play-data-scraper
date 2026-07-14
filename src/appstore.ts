import type {
  AppRecord,
  AppleApp,
  AppleSearchResponse,
  SourceJobOutcome,
  SourceJobResult,
} from './types.js';
import {
  boundedNumberOrNull,
  dateOrNull,
  fetchJson,
  nonNegativeIntegerOrNull,
  normalizeText,
  redactPersonalText,
  safeErrorMessage,
  truncateText,
  uniqueStrings,
} from './utils.js';

const API_BASE = 'https://itunes.apple.com';
const MAX_SCREENSHOTS = 20;
type AppleRequester = <T>(url: string, options?: RequestInit) => Promise<T>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertAppleResponse(value: unknown): AppleSearchResponse {
  if (!isObject(value) || !Array.isArray(value.results)) {
    throw new Error('Apple API returned an unexpected response shape.');
  }
  return value as AppleSearchResponse;
}

function currencyOrNull(value: unknown): string | null {
  const currency = normalizeText(value)?.toUpperCase() ?? null;
  return currency && /^[A-Z]{3}$/.test(currency) ? currency : null;
}

export function appleApiLanguage(language: string): 'en_us' | 'ja_jp' {
  return language.toLowerCase() === 'ja' ? 'ja_jp' : 'en_us';
}

export function mapAppleApp(
  app: AppleApp,
  country: string,
  language: string,
  query: string | null,
  includeRatingsSummary: boolean,
  scrapedAt = new Date(),
): AppRecord | null {
  const appId = app.trackId != null ? String(app.trackId) : normalizeText(app.bundleId);
  const appName = truncateText(redactPersonalText(app.trackName), 500);
  const appUrl = normalizeText(app.trackViewUrl);
  if (!appId || !appName || !appUrl) return null;

  const screenshots = uniqueStrings([
    ...(app.screenshotUrls ?? []),
    ...(app.ipadScreenshotUrls ?? []),
    ...(app.appletvScreenshotUrls ?? []),
  ]).slice(0, MAX_SCREENSHOTS);

  return {
    source: 'app_store',
    query,
    recordKey: `app_store:${appId}`,
    appId,
    bundleId: truncateText(app.bundleId, 255),
    appName,
    developer: truncateText(redactPersonalText(app.sellerName ?? app.artistName), 500),
    category: truncateText(redactPersonalText(app.primaryGenreName), 200),
    price: boundedNumberOrNull(app.price, 0, 1_000_000_000),
    currency: currencyOrNull(app.currency),
    ratingValue: includeRatingsSummary ? boundedNumberOrNull(app.averageUserRating, 0, 5) : null,
    ratingCount: includeRatingsSummary ? nonNegativeIntegerOrNull(app.userRatingCount) : null,
    ratingHistogram: null,
    installRange: null,
    version: truncateText(app.version, 100),
    contentRating: truncateText(app.contentAdvisoryRating ?? app.trackContentRating, 100),
    releaseDate: dateOrNull(app.releaseDate),
    lastUpdated: dateOrNull(app.currentVersionReleaseDate),
    description: truncateText(redactPersonalText(app.description), 20_000),
    iconUrl: normalizeText(app.artworkUrl512 ?? app.artworkUrl100 ?? app.artworkUrl60),
    screenshots,
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

function appendAppleRecords(
  target: AppRecord[],
  data: AppleSearchResponse,
  maxRecords: number,
  country: string,
  language: string,
  query: string | null,
  includeRatingsSummary: boolean,
): void {
  for (const app of data.results ?? []) {
    if (target.length >= maxRecords) break;
    if (app.wrapperType !== 'software' && app.kind !== 'software' && app.trackId == null) continue;
    const record = mapAppleApp(app, country, language, query, includeRatingsSummary);
    if (record) target.push(record);
  }
}

export async function searchAppStore(
  query: string,
  maxRecords: number,
  country: string,
  language: string,
  includeRatingsSummary: boolean,
  userAgent: string,
  request: AppleRequester = fetchJson,
): Promise<SourceJobResult> {
  const url = new URL(`${API_BASE}/search`);
  url.searchParams.set('term', query);
  url.searchParams.set('media', 'software');
  url.searchParams.set('entity', 'software');
  url.searchParams.set('limit', String(Math.min(Math.max(maxRecords, 1), 200)));
  url.searchParams.set('country', country);
  url.searchParams.set('lang', appleApiLanguage(language));

  const data = assertAppleResponse(await request<unknown>(url.toString(), {
    headers: { 'user-agent': userAgent },
  }));
  const records: AppRecord[] = [];
  appendAppleRecords(records, data, maxRecords, country, language, query, includeRatingsSummary);
  return { records, warnings: [], outcome: 'success' };
}

export async function lookupAppStore(
  rawIds: string[],
  maxRecords: number,
  country: string,
  language: string,
  includeRatingsSummary: boolean,
  userAgent: string,
  request: AppleRequester = fetchJson,
): Promise<SourceJobResult> {
  const records: AppRecord[] = [];
  const warnings: string[] = [];
  let successfulRequests = 0;
  let failedRequests = 0;
  const attemptLimit = Math.min(200, Math.max(maxRecords * 2, 10));
  const ids = uniqueStrings(rawIds).slice(0, attemptLimit);
  const numericIds = ids.filter((id) => /^\d+$/.test(id));
  const bundleIds = ids.filter((id) => !/^\d+$/.test(id));

  if (numericIds.length > 0 && records.length < maxRecords) {
    const url = new URL(`${API_BASE}/lookup`);
    url.searchParams.set('id', numericIds.join(','));
    url.searchParams.set('entity', 'software');
    url.searchParams.set('country', country);
    url.searchParams.set('lang', appleApiLanguage(language));
    try {
      const data = assertAppleResponse(await request<unknown>(url.toString(), {
        headers: { 'user-agent': userAgent },
      }));
      successfulRequests += 1;
      appendAppleRecords(records, data, maxRecords, country, language, null, includeRatingsSummary);
    } catch (error) {
      failedRequests += 1;
      warnings.push(`Apple numeric-ID lookup failed: ${safeErrorMessage(error)}`);
    }
  }

  for (const bundleId of bundleIds) {
    if (records.length >= maxRecords) break;
    const url = new URL(`${API_BASE}/lookup`);
    url.searchParams.set('bundleId', bundleId);
    url.searchParams.set('entity', 'software');
    url.searchParams.set('country', country);
    url.searchParams.set('lang', appleApiLanguage(language));
    try {
      const data = assertAppleResponse(await request<unknown>(url.toString(), {
        headers: { 'user-agent': userAgent },
      }));
      successfulRequests += 1;
      appendAppleRecords(records, data, maxRecords, country, language, null, includeRatingsSummary);
    } catch (error) {
      failedRequests += 1;
      warnings.push(`Apple bundle-ID lookup failed: ${safeErrorMessage(error)}`);
    }
  }

  return {
    records,
    warnings,
    outcome: outcomeForRequests(successfulRequests, failedRequests),
  };
}
