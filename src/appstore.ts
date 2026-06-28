import { log } from 'apify';
import type { AppRecord, AppleApp, AppleSearchResponse } from './types.js';
import { dateOrNull, fetchJson, normalizeText, numberOrNull, redactPersonalText, uniqueStrings } from './utils.js';

const API_BASE = 'https://itunes.apple.com';

function normalizeAppleAppId(raw: string): string {
  const text = raw.trim();
  const idMatch = text.match(/[?&]id=(\d{5,})/i) ?? text.match(/\/id(\d{5,})/i) ?? text.match(/^(\d{5,})$/);
  return idMatch?.[1] ?? text;
}

function isNumericId(value: string): boolean {
  return /^\d+$/.test(value);
}

function mapAppleApp(app: AppleApp, country: string, query: string | null, includeRatingsSummary: boolean): AppRecord | null {
  const appId = app.trackId != null ? String(app.trackId) : normalizeText(app.bundleId);
  if (!appId) return null;

  const screenshots = uniqueStrings([
    ...(app.screenshotUrls ?? []),
    ...(app.ipadScreenshotUrls ?? []),
    ...(app.appletvScreenshotUrls ?? []),
  ]);

  return {
    source: 'app_store',
    query,
    appId,
    bundleId: normalizeText(app.bundleId),
    appName: redactPersonalText(app.trackName),
    developer: redactPersonalText(app.sellerName ?? app.artistName),
    category: redactPersonalText(app.primaryGenreName),
    price: numberOrNull(app.price),
    currency: normalizeText(app.currency),
    ratingValue: includeRatingsSummary ? numberOrNull(app.averageUserRating) : null,
    ratingCount: includeRatingsSummary ? numberOrNull(app.userRatingCount) : null,
    ratingHistogram: null,
    installRange: null,
    version: normalizeText(app.version),
    contentRating: normalizeText(app.contentAdvisoryRating ?? app.trackContentRating),
    releaseDate: dateOrNull(app.releaseDate),
    lastUpdated: dateOrNull(app.currentVersionReleaseDate),
    description: redactPersonalText(app.description),
    iconUrl: normalizeText(app.artworkUrl512 ?? app.artworkUrl100 ?? app.artworkUrl60),
    screenshots,
    appUrl: normalizeText(app.trackViewUrl),
    country,
    scrapedAt: new Date().toISOString(),
  };
}

export async function searchAppStore(
  query: string,
  maxRecords: number,
  country: string,
  language: string,
  includeRatingsSummary: boolean,
  userAgent: string,
): Promise<AppRecord[]> {
  const url = new URL(`${API_BASE}/search`);
  url.searchParams.set('term', query);
  url.searchParams.set('entity', 'software');
  url.searchParams.set('limit', String(Math.min(Math.max(maxRecords, 1), 200)));
  url.searchParams.set('country', country);
  url.searchParams.set('lang', language);

  const data = await fetchJson<AppleSearchResponse>(url.toString(), { headers: { 'user-agent': userAgent } });
  return (data.results ?? [])
    .filter((app) => app.wrapperType === 'software' || app.kind === 'software' || app.trackId != null)
    .map((app) => mapAppleApp(app, country, query, includeRatingsSummary))
    .filter((record): record is AppRecord => record !== null)
    .slice(0, maxRecords);
}

export async function lookupAppStore(
  rawIds: string[],
  maxRecords: number,
  country: string,
  language: string,
  includeRatingsSummary: boolean,
  userAgent: string,
): Promise<AppRecord[]> {
  const records: AppRecord[] = [];
  const ids = uniqueStrings(rawIds.map(normalizeAppleAppId));
  const numericIds = ids.filter(isNumericId);
  const bundleIds = ids.filter((id) => !isNumericId(id));

  if (numericIds.length > 0 && records.length < maxRecords) {
    const url = new URL(`${API_BASE}/lookup`);
    url.searchParams.set('id', numericIds.slice(0, 200).join(','));
    url.searchParams.set('entity', 'software');
    url.searchParams.set('country', country);
    url.searchParams.set('lang', language);
    try {
      const data = await fetchJson<AppleSearchResponse>(url.toString(), { headers: { 'user-agent': userAgent } });
      for (const app of data.results ?? []) {
        if (records.length >= maxRecords) break;
        const record = mapAppleApp(app, country, 'lookup', includeRatingsSummary);
        if (record) records.push(record);
      }
    } catch (error) {
      log.warning(`Skipped failed App Store numeric-ID lookup: ${(error as Error).message}`);
    }
  }

  for (const bundleId of bundleIds) {
    if (records.length >= maxRecords) break;
    const url = new URL(`${API_BASE}/lookup`);
    url.searchParams.set('bundleId', bundleId);
    url.searchParams.set('entity', 'software');
    url.searchParams.set('country', country);
    url.searchParams.set('lang', language);
    try {
      const data = await fetchJson<AppleSearchResponse>(url.toString(), { headers: { 'user-agent': userAgent } });
      for (const app of data.results ?? []) {
        if (records.length >= maxRecords) break;
        const record = mapAppleApp(app, country, bundleId, includeRatingsSummary);
        if (record) records.push(record);
      }
    } catch (error) {
      log.warning(`Skipped failed App Store bundle lookup for ${bundleId}: ${(error as Error).message}`);
    }
  }

  return records;
}
