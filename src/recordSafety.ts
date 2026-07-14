import type { AppRecord } from './types.js';

const FORBIDDEN_FIELDS = new Set([
  'contact',
  'contactemail',
  'contactphone',
  'developeraddress',
  'developeremail',
  'developerlegaladdress',
  'developerlegalemail',
  'developerlegalphonenumber',
  'email',
  'emails',
  'phone',
  'phones',
  'review',
  'reviewer',
  'reviewerid',
  'reviewername',
  'reviews',
  'username',
]);

function normalizedKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

export function containsForbiddenField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenField);
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(([key, nested]) => (
    FORBIDDEN_FIELDS.has(normalizedKey(key)) || containsForbiddenField(nested)
  ));
}

function isHttpsHost(value: string | null, allowed: (hostname: string) => boolean): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && allowed(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isStoreUrl(record: AppRecord): boolean {
  try {
    const url = new URL(record.appUrl);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:') return false;
    if (record.source === 'google_play') {
      return hostname === 'play.google.com'
        && url.pathname.startsWith('/store/apps/details')
        && url.searchParams.get('id') === record.appId;
    }
    if (hostname !== 'apps.apple.com' && hostname !== 'itunes.apple.com') return false;
    const urlId = url.searchParams.get('id') ?? url.pathname.match(/\/id(\d{5,20})(?:\/|$)/i)?.[1] ?? null;
    if (!urlId) return false;
    return /^\d+$/.test(record.appId) ? urlId === record.appId : true;
  } catch {
    return false;
  }
}

function isMediaUrl(record: AppRecord, value: string | null): boolean {
  if (!value) return true;
  return record.source === 'app_store'
    ? isHttpsHost(value, (host) => host === 'mzstatic.com' || host.endsWith('.mzstatic.com'))
    : isHttpsHost(value, (host) => host === 'googleusercontent.com' || host.endsWith('.googleusercontent.com'));
}

function validIsoDate(value: string | null): boolean {
  if (!value) return true;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

export function recordSafetyIssue(record: AppRecord): string | null {
  if (containsForbiddenField(record)) return 'record contains a forbidden personal-data field';
  if (!record.appName.trim()) return 'record is missing an app name';
  if (record.recordKey !== `${record.source}:${record.appId}`) return 'recordKey is not source scoped';
  if (!isStoreUrl(record)) return 'appUrl is not an official HTTPS store URL';
  if (!isMediaUrl(record, record.iconUrl)) return 'iconUrl is not an approved store media URL';
  if (record.screenshots.length > 20 || record.screenshots.some((url) => !isMediaUrl(record, url))) {
    return 'record contains an invalid or excessive screenshot list';
  }
  if (!/^[a-z]{2}$/.test(record.country) || !/^[a-z]{2}$/.test(record.language)) {
    return 'record has an invalid country or language code';
  }
  if (record.price !== null && record.price < 0) return 'record has a negative price';
  if (record.ratingValue !== null && (record.ratingValue < 0 || record.ratingValue > 5)) {
    return 'record has an invalid rating value';
  }
  if (record.ratingCount !== null && (!Number.isInteger(record.ratingCount) || record.ratingCount < 0)) {
    return 'record has an invalid rating count';
  }
  if (!validIsoDate(record.releaseDate) || !validIsoDate(record.lastUpdated) || !validIsoDate(record.scrapedAt)) {
    return 'record has an invalid normalized date';
  }
  if (record.description && record.description.length > 20_000) return 'record description is too large';
  return null;
}

export function assertSafeRecord(record: AppRecord): AppRecord {
  const issue = recordSafetyIssue(record);
  if (issue) throw new Error(issue);
  return record;
}
