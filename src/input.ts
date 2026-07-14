import type { NormalizedInput, ProxyInput, SourceName } from './types.js';
import { normalizeText, uniqueStrings } from './utils.js';

const DEFAULT_SOURCES: SourceName[] = ['app_store', 'google_play'];
export const DEFAULT_USER_AGENT = 'AppStoreGooglePlayDataScraper/1.0 app-market-research';
const VALID_SOURCES = new Set<SourceName>(DEFAULT_SOURCES);
const ALLOWED_FIELDS = new Set([
  'sources',
  'searchQueries',
  'appIds',
  'packageNames',
  'country',
  'language',
  'includeRatingsSummary',
  'maxResults',
  'userAgent',
  'proxyConfiguration',
]);
const PROXY_FIELDS = new Set(['useApifyProxy', 'apifyProxyGroups', 'apifyProxyCountry', 'proxyUrls']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, field: string, maximumLength: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`);
  if (/\r|\n|[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) {
    throw new Error(`${field} must not contain line breaks or control characters.`);
  }
  const text = normalizeText(value);
  if (!text) return null;
  if (text.length > maximumLength) throw new Error(`${field} must be at most ${maximumLength} characters.`);
  return text;
}

function readArray(value: unknown, field: string, maximumItems: number): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  if (value.length > maximumItems) throw new Error(`${field} must contain at most ${maximumItems} items.`);
  return value;
}

function readTextArray(value: unknown, field: string, maximumItems: number, maximumLength: number): string[] {
  return uniqueStrings(readArray(value, field, maximumItems).map((item, index) => {
    if (typeof item !== 'string') throw new Error(`${field}[${index}] must be a string.`);
    const text = readString(item, `${field}[${index}]`, maximumLength);
    if (!text) throw new Error(`${field}[${index}] must not be empty.`);
    return text;
  }));
}

function normalizeSources(value: unknown): SourceName[] {
  if (value === undefined || value === null) return [...DEFAULT_SOURCES];
  const values = readArray(value, 'sources', 2);
  if (!values.length) throw new Error('sources must be a non-empty array.');
  const sources = uniqueStrings(values.map((item, index) => {
    if (typeof item !== 'string') throw new Error(`sources[${index}] must be a string.`);
    return item.toLowerCase();
  }));
  for (const source of sources) {
    if (!VALID_SOURCES.has(source as SourceName)) throw new Error(`Unsupported source: ${source}.`);
  }
  return sources as SourceName[];
}

export function normalizeAppleIdentifier(raw: string): string {
  const text = raw.trim();
  if (/^https?:\/\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      throw new Error(`Invalid Apple App Store URL: ${text}.`);
    }
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !['apps.apple.com', 'itunes.apple.com'].includes(hostname)) {
      throw new Error('Apple app URLs must use HTTPS on apps.apple.com or itunes.apple.com.');
    }
    const id = url.searchParams.get('id') ?? url.pathname.match(/\/id(\d{5,20})(?:\/|$)/i)?.[1] ?? null;
    if (!id) throw new Error(`Apple app URL does not contain a numeric app ID: ${text}.`);
    return id;
  }
  if (/^\d{5,20}$/.test(text)) return text;
  if (/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(text) && text.length <= 255) return text;
  throw new Error(`Invalid Apple app ID or bundle ID: ${text}.`);
}

export function normalizeGooglePackageName(raw: string): string {
  const text = raw.trim();
  let packageName = text;
  if (/^https?:\/\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      throw new Error(`Invalid Google Play URL: ${text}.`);
    }
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'play.google.com') {
      throw new Error('Google Play URLs must use HTTPS on play.google.com.');
    }
    if (!url.pathname.startsWith('/store/apps/details')) {
      throw new Error('Google Play URL must point to an app details page.');
    }
    packageName = url.searchParams.get('id') ?? '';
  }
  if (
    packageName.length > 255
    || !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName)
  ) {
    throw new Error(`Invalid Google Play package name: ${packageName || text}.`);
  }
  return packageName;
}

function normalizeProxy(value: unknown): ProxyInput | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isObject(value)) throw new Error('proxyConfiguration must be an object.');
  const unknownFields = Object.keys(value).filter((key) => !PROXY_FIELDS.has(key));
  if (unknownFields.length) throw new Error(`Unsupported proxyConfiguration field: ${unknownFields[0]}.`);

  if (value.useApifyProxy !== undefined && typeof value.useApifyProxy !== 'boolean') {
    throw new Error('proxyConfiguration.useApifyProxy must be a boolean.');
  }
  const groups = readTextArray(value.apifyProxyGroups, 'proxyConfiguration.apifyProxyGroups', 10, 50);
  const proxyUrls = readTextArray(value.proxyUrls, 'proxyConfiguration.proxyUrls', 20, 2000);
  for (const proxyUrl of proxyUrls) {
    let parsed: URL;
    try {
      parsed = new URL(proxyUrl);
    } catch {
      throw new Error('Each custom proxy URL must be a valid URL.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Custom proxy URLs must use http or https.');
    }
  }
  const country = readString(value.apifyProxyCountry, 'proxyConfiguration.apifyProxyCountry', 2)?.toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) {
    throw new Error('proxyConfiguration.apifyProxyCountry must be a two-letter country code.');
  }
  if (value.useApifyProxy === true && proxyUrls.length) {
    throw new Error('Choose Apify Proxy or custom proxy URLs, not both.');
  }

  return {
    ...(value.useApifyProxy !== undefined ? { useApifyProxy: value.useApifyProxy } : {}),
    ...(groups.length ? { apifyProxyGroups: groups } : {}),
    ...(country ? { apifyProxyCountry: country } : {}),
    ...(proxyUrls.length ? { proxyUrls } : {}),
  };
}

function proxyRequested(proxy: ProxyInput | undefined): boolean {
  return Boolean(proxy?.useApifyProxy || proxy?.proxyUrls?.length);
}

export function normalizeInput(rawInput: unknown): NormalizedInput {
  if (!isObject(rawInput)) throw new Error('Input must be a JSON object.');
  const unknownFields = Object.keys(rawInput).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unknownFields.length) throw new Error(`Unsupported input field: ${unknownFields[0]}.`);

  const sources = normalizeSources(rawInput.sources);
  const anyTargetFieldProvided = ['searchQueries', 'appIds', 'packageNames']
    .some((field) => Object.prototype.hasOwnProperty.call(rawInput, field));
  const searchQueries = anyTargetFieldProvided
    ? readTextArray(rawInput.searchQueries, 'searchQueries', 20, 100)
    : ['whatsapp'];
  for (const query of searchQueries) {
    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(query) || /\b(?:mailto|tel):/i.test(query)) {
      throw new Error('searchQueries must contain app-market keywords, not contact identifiers.');
    }
  }

  const appIds = uniqueStrings(readTextArray(rawInput.appIds, 'appIds', 200, 1000)
    .map(normalizeAppleIdentifier));
  const packageNames = uniqueStrings(readTextArray(rawInput.packageNames, 'packageNames', 200, 1000)
    .map(normalizeGooglePackageName));
  if (!searchQueries.length && !appIds.length && !packageNames.length) {
    throw new Error('Provide at least one search query, Apple app ID/bundle ID, or Google Play package name.');
  }
  if (sources.includes('app_store') && !searchQueries.length && !appIds.length) {
    throw new Error('app_store requires searchQueries or appIds.');
  }
  if (sources.includes('google_play') && !searchQueries.length && !packageNames.length) {
    throw new Error('google_play requires searchQueries or packageNames.');
  }

  const country = (readString(rawInput.country, 'country', 2) ?? 'us').toLowerCase();
  if (!/^[a-z]{2}$/.test(country)) throw new Error('country must be a two-letter ISO country code.');
  const language = (readString(rawInput.language, 'language', 2) ?? 'en').toLowerCase();
  if (!/^[a-z]{2}$/.test(language)) throw new Error('language must be a two-letter language code.');

  const includeRatingsSummary = rawInput.includeRatingsSummary ?? true;
  if (typeof includeRatingsSummary !== 'boolean') throw new Error('includeRatingsSummary must be a boolean.');
  const maxResults = rawInput.maxResults ?? 10;
  if (!Number.isInteger(maxResults) || Number(maxResults) < 1 || Number(maxResults) > 1000) {
    throw new Error('maxResults must be an integer between 1 and 1000.');
  }
  const userAgent = readString(rawInput.userAgent, 'userAgent', 255) ?? DEFAULT_USER_AGENT;
  const proxyConfiguration = normalizeProxy(rawInput.proxyConfiguration);
  if (proxyRequested(proxyConfiguration) && !sources.includes('google_play')) {
    throw new Error('proxyConfiguration applies only when google_play is selected.');
  }

  return {
    sources,
    searchQueries,
    appIds,
    packageNames,
    country,
    language,
    includeRatingsSummary,
    maxResults: Number(maxResults),
    userAgent,
    ...(proxyConfiguration ? { proxyConfiguration } : {}),
  };
}
