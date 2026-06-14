import gplayDefault from 'google-play-scraper';
import type { AppRecord, RatingHistogram } from './types.js';
import { dateOrNull, normalizeText, numberOrNull, redactPersonalText, uniqueStrings } from './utils.js';

const gplay: any = (gplayDefault as any).app ? gplayDefault : (gplayDefault as any).default;

function normalizePackageName(raw: string): string {
  const text = raw.trim();
  const idMatch = text.match(/[?&]id=([^&]+)/);
  return decodeURIComponent(idMatch?.[1] ?? text);
}

function normalizeHistogram(value: unknown): RatingHistogram | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const oneStar = numberOrNull(source['1'] ?? source.oneStar ?? source.one);
  const twoStar = numberOrNull(source['2'] ?? source.twoStar ?? source.two);
  const threeStar = numberOrNull(source['3'] ?? source.threeStar ?? source.three);
  const fourStar = numberOrNull(source['4'] ?? source.fourStar ?? source.four);
  const fiveStar = numberOrNull(source['5'] ?? source.fiveStar ?? source.five);
  return [oneStar, twoStar, threeStar, fourStar, fiveStar].some((item) => item !== null)
    ? { oneStar, twoStar, threeStar, fourStar, fiveStar }
    : null;
}

function mapGoogleApp(app: any, country: string, query: string | null, includeRatingsSummary: boolean): AppRecord | null {
  const appId = normalizeText(app.appId);
  if (!appId) return null;
  return {
    source: 'google_play',
    query,
    appId,
    bundleId: appId,
    appName: redactPersonalText(app.title),
    developer: redactPersonalText(app.developer),
    category: redactPersonalText(app.genre),
    price: numberOrNull(app.price),
    currency: normalizeText(app.currency),
    ratingValue: includeRatingsSummary ? numberOrNull(app.score) : null,
    ratingCount: includeRatingsSummary ? numberOrNull(app.ratings) : null,
    ratingHistogram: includeRatingsSummary ? normalizeHistogram(app.histogram ?? app.ratingHistogram ?? app.ratingsHistogram) : null,
    installRange: normalizeText(app.installs),
    version: normalizeText(app.version),
    contentRating: normalizeText(app.contentRating),
    releaseDate: dateOrNull(app.released),
    lastUpdated: dateOrNull(app.updated),
    description: redactPersonalText(app.description ?? app.summary),
    iconUrl: normalizeText(app.icon),
    screenshots: uniqueStrings(app.screenshots ?? []),
    appUrl: normalizeText(app.url) ?? `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}`,
    country,
    scrapedAt: new Date().toISOString(),
  };
}

export async function searchGooglePlay(
  query: string,
  maxRecords: number,
  country: string,
  language: string,
  includeRatingsSummary: boolean,
  requestOptions: Record<string, unknown>,
): Promise<AppRecord[]> {
  const searchResults = await gplay.search({
    term: query,
    num: Math.min(Math.max(maxRecords, 1), 100),
    country,
    lang: language,
    throttle: 8,
    requestOptions,
  });
  const ids = uniqueStrings((searchResults ?? []).map((item: any) => item.appId)).slice(0, maxRecords);
  return lookupGooglePlay(ids, maxRecords, country, language, includeRatingsSummary, requestOptions, query);
}

export async function lookupGooglePlay(
  rawPackageNames: string[],
  maxRecords: number,
  country: string,
  language: string,
  includeRatingsSummary: boolean,
  requestOptions: Record<string, unknown>,
  query: string | null = 'lookup',
): Promise<AppRecord[]> {
  const records: AppRecord[] = [];
  const packageNames = uniqueStrings(rawPackageNames.map(normalizePackageName));
  for (const appId of packageNames) {
    if (records.length >= maxRecords) break;
    const app = await gplay.app({
      appId,
      country,
      lang: language,
      throttle: 8,
      requestOptions,
    });
    const record = mapGoogleApp(app, country, query, includeRatingsSummary);
    if (record) records.push(record);
  }
  return records;
}
