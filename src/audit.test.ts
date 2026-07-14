import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appleApiLanguage,
  lookupAppStore,
  mapAppleApp,
  searchAppStore,
} from './appstore.js';
import { allocateBudget, pushUniqueRecords } from './billing.js';
import {
  lookupGooglePlay,
  mapGoogleApp,
  retryGoogle,
  searchGooglePlay,
} from './googleplay.js';
import {
  normalizeAppleIdentifier,
  normalizeGooglePackageName,
  normalizeInput,
} from './input.js';
import { containsForbiddenField, recordSafetyIssue } from './recordSafety.js';
import { classifyRunOutcome } from './runOutcome.js';
import type { AppRecord, AppleApp, GooglePlayClient } from './types.js';
import {
  dateOrNull,
  fetchJson,
  HttpError,
  redactPersonalText,
  safeErrorMessage,
  uniqueStrings,
} from './utils.js';

function validGoogleRecord(overrides: Partial<AppRecord> = {}): AppRecord {
  return {
    source: 'google_play',
    query: null,
    recordKey: 'google_play:com.example.app',
    appId: 'com.example.app',
    bundleId: 'com.example.app',
    appName: 'Example App',
    developer: 'Example Studio',
    category: 'Tools',
    price: 0,
    currency: 'USD',
    ratingValue: 4.5,
    ratingCount: 10,
    ratingHistogram: null,
    installRange: '1,000+',
    version: '1.0.0',
    contentRating: 'Everyone',
    releaseDate: '2024-01-01T00:00:00.000Z',
    lastUpdated: '2025-01-01T00:00:00.000Z',
    description: 'Public app description',
    iconUrl: 'https://play-lh.googleusercontent.com/icon',
    screenshots: ['https://play-lh.googleusercontent.com/screenshot'],
    appUrl: 'https://play.google.com/store/apps/details?id=com.example.app',
    country: 'us',
    language: 'en',
    scrapedAt: '2026-07-14T00:00:00.000Z',
    ...overrides,
  };
}

test('normalizeInput supplies only the documented safe keyword fallback', () => {
  const input = normalizeInput({});
  assert.deepEqual(input.sources, ['app_store', 'google_play']);
  assert.deepEqual(input.searchQueries, ['whatsapp']);
  assert.deepEqual(input.appIds, []);
  assert.deepEqual(input.packageNames, []);
});

test('normalizeInput accepts official direct URLs and does not add a search', () => {
  const input = normalizeInput({
    sources: ['app_store', 'google_play'],
    appIds: ['https://apps.apple.com/us/app/example/id310633997'],
    packageNames: ['https://play.google.com/store/apps/details?id=com.whatsapp'],
  });
  assert.deepEqual(input.searchQueries, []);
  assert.deepEqual(input.appIds, ['310633997']);
  assert.deepEqual(input.packageNames, ['com.whatsapp']);
});

test('normalizeInput rejects empty targets and source-target mismatches', () => {
  assert.throws(
    () => normalizeInput({ searchQueries: [], appIds: [], packageNames: [] }),
    /Provide at least one/,
  );
  assert.throws(
    () => normalizeInput({ sources: ['app_store'], packageNames: ['com.example.app'] }),
    /app_store requires/,
  );
});

test('normalizeInput rejects unknown fields, contact searches, and invalid bounds', () => {
  assert.throws(() => normalizeInput({ surprise: true }), /Unsupported input field/);
  assert.throws(() => normalizeInput({ searchQueries: ['owner@example.com'] }), /contact identifiers/);
  assert.throws(() => normalizeInput({ searchQueries: ['apps'], maxResults: 0 }), /between 1 and 1000/);
  assert.throws(() => normalizeInput({ searchQueries: ['apps'], userAgent: 'safe\r\nX-Test: bad' }), /line breaks/);
});

test('direct identifier normalizers reject lookalike and insecure store URLs', () => {
  assert.equal(normalizeAppleIdentifier('com.example.ios'), 'com.example.ios');
  assert.equal(normalizeGooglePackageName('com.example.android'), 'com.example.android');
  assert.throws(() => normalizeAppleIdentifier('https://apps.apple.com.evil.test/app/id310633997'), /must use HTTPS/);
  assert.throws(() => normalizeAppleIdentifier('http://apps.apple.com/app/id310633997'), /must use HTTPS/);
  assert.throws(() => normalizeGooglePackageName('https://play.google.com.evil.test/store/apps/details?id=com.example.app'), /must use HTTPS/);
  assert.throws(() => normalizeGooglePackageName('https://play.google.com/store/books/details?id=com.example.app'), /app details page/);
});

test('proxy validation disallows Apple-only use and mixed proxy modes', () => {
  assert.throws(
    () => normalizeInput({
      sources: ['app_store'],
      appIds: ['310633997'],
      proxyConfiguration: { useApifyProxy: true },
    }),
    /google_play/,
  );
  assert.throws(
    () => normalizeInput({
      sources: ['google_play'],
      packageNames: ['com.example.app'],
      proxyConfiguration: { useApifyProxy: true, proxyUrls: ['https://proxy.example.test'] },
    }),
    /not both/,
  );
});

test('utility normalization rejects invalid dates and redacts contact text', () => {
  assert.equal(dateOrNull('2025-02-29'), null);
  assert.equal(dateOrNull('not a date'), null);
  assert.equal(dateOrNull(1_700_000_000_000), new Date(1_700_000_000_000).toISOString());
  assert.equal(
    redactPersonalText('Email owner@example.com or call +1 (555) 123-4567.'),
    'Email [redacted email] or call [redacted phone].',
  );
  assert.deepEqual(uniqueStrings([' App ', 'app', 'Other']), ['App', 'Other']);
});

test('safeErrorMessage removes proxy credentials and sensitive query values', () => {
  const message = safeErrorMessage(new Error(
    'GET https://user:secret@proxy.test/path?term=private&id=com.secret.app failed',
  ));
  assert.doesNotMatch(message, /user:secret/);
  assert.doesNotMatch(message, /private|com\.secret\.app/);
});

test('Apple language mapping follows the API-supported response languages', () => {
  assert.equal(appleApiLanguage('ja'), 'ja_jp');
  assert.equal(appleApiLanguage('fr'), 'en_us');
});

test('Apple mapper creates a bounded, redacted, locale-aware record', () => {
  const app: AppleApp = {
    trackId: 12345,
    trackName: 'Example',
    sellerName: 'Contact owner@example.com',
    description: 'Call +1 555 123 4567',
    trackViewUrl: 'https://apps.apple.com/us/app/example/id12345',
    artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/icon.png',
    screenshotUrls: Array.from({ length: 25 }, (_, index) => `https://is${index % 5 + 1}-ssl.mzstatic.com/${index}.png`),
    releaseDate: 'bad-date',
  };
  const record = mapAppleApp(app, 'us', 'en', 'example', true, new Date('2026-07-14T00:00:00Z'));
  assert.ok(record);
  assert.equal(record.recordKey, 'app_store:12345');
  assert.equal(record.developer, 'Contact [redacted email]');
  assert.match(record.description ?? '', /redacted phone/);
  assert.equal(record.releaseDate, null);
  assert.equal(record.screenshots.length, 20);
  assert.equal(record.language, 'en');
});

test('Apple search sends bounded official API parameters', async () => {
  let capturedUrl = '';
  const request = async <T>(url: string): Promise<T> => {
    capturedUrl = url;
    return { resultCount: 0, results: [] } as T;
  };
  const result = await searchAppStore('weather', 500, 'gb', 'ja', true, 'test-agent', request);
  const url = new URL(capturedUrl);
  assert.equal(url.hostname, 'itunes.apple.com');
  assert.equal(url.searchParams.get('limit'), '200');
  assert.equal(url.searchParams.get('country'), 'gb');
  assert.equal(url.searchParams.get('lang'), 'ja_jp');
  assert.equal(result.outcome, 'success');
});

test('Apple lookup reports mixed source availability as partial', async () => {
  const request = async <T>(url: string): Promise<T> => {
    if (url.includes('bundleId=')) throw new Error('temporary bundle lookup failure');
    return {
      resultCount: 1,
      results: [{
        trackId: 12345,
        trackName: 'Example',
        trackViewUrl: 'https://apps.apple.com/us/app/example/id12345',
      }],
    } as T;
  };
  const result = await lookupAppStore(
    ['12345', 'com.example.ios'],
    10,
    'us',
    'en',
    true,
    'test-agent',
    request,
  );
  assert.equal(result.records.length, 1);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.outcome, 'partial');
});

test('Apple search rejects a malformed API response', async () => {
  const request = async <T>(): Promise<T> => ({ unexpected: true }) as T;
  await assert.rejects(
    searchAppStore('weather', 1, 'us', 'en', true, 'test-agent', request),
    /unexpected response shape/,
  );
});

test('Google mapper normalizes fields and caps media', () => {
  const record = mapGoogleApp({
    appId: 'com.example.app',
    title: 'Example',
    developer: 'Example Studio',
    score: 9,
    ratings: -1,
    updated: 1_700_000_000_000,
    icon: 'https://play-lh.googleusercontent.com/icon',
    screenshots: Array.from({ length: 25 }, (_, index) => `https://play-lh.googleusercontent.com/${index}`),
  }, 'in', 'en', null, true, new Date('2026-07-14T00:00:00Z'));
  assert.ok(record);
  assert.equal(record.appUrl, 'https://play.google.com/store/apps/details?id=com.example.app');
  assert.equal(record.ratingValue, null);
  assert.equal(record.ratingCount, null);
  assert.equal(record.screenshots.length, 20);
  assert.equal(record.lastUpdated, new Date(1_700_000_000_000).toISOString());
});

test('Google lookup treats a real 404 as a successful empty lookup', async () => {
  const notFound = Object.assign(new Error('App not found (404)'), { status: 404 });
  const client: GooglePlayClient = {
    search: async () => [],
    app: async () => { throw notFound; },
  };
  const result = await lookupGooglePlay(['com.missing.app'], 1, 'us', 'en', true, {}, null, client);
  assert.deepEqual(result.records, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.outcome, 'success');
});

test('Google lookup exposes mixed parser/request failures as partial', async () => {
  const client: GooglePlayClient = {
    search: async () => [],
    app: async (options) => {
      if (options.appId === 'com.good.app') {
        return { appId: 'com.good.app', title: 'Good App' };
      }
      throw Object.assign(new Error('parser changed'), { status: 400 });
    },
  };
  const result = await lookupGooglePlay(
    ['com.good.app', 'com.bad.app'],
    2,
    'us',
    'en',
    true,
    {},
    null,
    client,
  );
  assert.equal(result.records.length, 1);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.outcome, 'partial');
});

test('Google retry retries transient errors but not permanent 404s', async () => {
  let transientCalls = 0;
  const transient = await retryGoogle(async () => {
    transientCalls += 1;
    if (transientCalls < 3) throw Object.assign(new Error('unavailable'), { status: 503 });
    return 'ok';
  }, 3, async () => undefined);
  assert.equal(transient, 'ok');
  assert.equal(transientCalls, 3);

  let permanentCalls = 0;
  await assert.rejects(retryGoogle(async () => {
    permanentCalls += 1;
    throw Object.assign(new Error('missing'), { status: 404 });
  }, 3, async () => undefined));
  assert.equal(permanentCalls, 1);

  let nestedStatusCalls = 0;
  const nestedStatus = await retryGoogle(async () => {
    nestedStatusCalls += 1;
    if (nestedStatusCalls === 1) {
      throw Object.assign(new Error('request failed'), { response: { statusCode: 429 } });
    }
    return 'recovered';
  }, 2, async () => undefined);
  assert.equal(nestedStatus, 'recovered');
  assert.equal(nestedStatusCalls, 2);
});

test('Google search rejects parser rows that lack package IDs', async () => {
  const client: GooglePlayClient = {
    search: async () => [{ title: 'No ID' }],
    app: async () => ({}),
  };
  await assert.rejects(
    searchGooglePlay('weather', 1, 'us', 'en', true, {}, client),
    /without package IDs/,
  );
});

test('record safety accepts official store records and rejects host lookalikes', () => {
  assert.equal(recordSafetyIssue(validGoogleRecord()), null);
  assert.match(
    recordSafetyIssue(validGoogleRecord({ appUrl: 'https://play.google.com.evil.test/store/apps/details?id=com.example.app' })) ?? '',
    /official HTTPS store URL/,
  );
  assert.match(
    recordSafetyIssue(validGoogleRecord({ appUrl: 'https://play.google.com/store/apps/details?id=com.different.app' })) ?? '',
    /official HTTPS store URL/,
  );
  assert.match(
    recordSafetyIssue(validGoogleRecord({ iconUrl: 'https://images.example.test/icon.png' })) ?? '',
    /approved store media URL/,
  );
});

test('privacy guard detects forbidden fields recursively', () => {
  assert.equal(containsForbiddenField({ nested: { developerEmail: 'owner@example.com' } }), true);
  assert.equal(containsForbiddenField({ nested: { publicName: 'Example Studio' } }), false);
});

test('billing helper saves free-user rows once and deduplicates record keys', async () => {
  const record = validGoogleRecord();
  let pushes = 0;
  const result = await pushUniqueRecords(
    [record, record],
    new Set<string>(),
    10,
    async () => {
      pushes += 1;
      return { chargedCount: 0, eventChargeLimitReached: false };
    },
  );
  assert.equal(pushes, 1);
  assert.deepEqual(result, { saved: 1, stoppedByChargeLimit: false });
});

test('billing helper stops cleanly before counting an unsaved limited record', async () => {
  const result = await pushUniqueRecords(
    [validGoogleRecord()],
    new Set<string>(),
    1,
    async () => ({ chargedCount: 0, eventChargeLimitReached: true }),
  );
  assert.deepEqual(result, { saved: 0, stoppedByChargeLimit: true });
});

test('budget allocation and run outcome classification are deterministic', () => {
  assert.equal(allocateBudget(10, 3), 4);
  assert.equal(allocateBudget(0, 2), 0);
  assert.equal(classifyRunOutcome({
    attemptedJobs: 2,
    successfulJobs: 0,
    warningCount: 2,
    savedCount: 0,
    stoppedByChargeLimit: false,
  }), 'failed');
  assert.equal(classifyRunOutcome({
    attemptedJobs: 2,
    successfulJobs: 1,
    warningCount: 1,
    savedCount: 1,
    stoppedByChargeLimit: false,
  }), 'partial');
  assert.equal(classifyRunOutcome({
    attemptedJobs: 1,
    successfulJobs: 1,
    warningCount: 0,
    savedCount: 0,
    stoppedByChargeLimit: false,
  }), 'empty');
});

test('fetchJson retries transient HTTP errors and does not retry permanent ones', async () => {
  let transientCalls = 0;
  const transientFetch = async (): Promise<Response> => {
    transientCalls += 1;
    return transientCalls === 1
      ? new Response('busy', { status: 503, statusText: 'Unavailable' })
      : new Response('{"ok":true}', { status: 200 });
  };
  const value = await fetchJson<{ ok: boolean }>('https://itunes.apple.com/search', {}, {
    retries: 3,
    pace: false,
    fetchImpl: transientFetch,
    sleep: async () => undefined,
  });
  assert.deepEqual(value, { ok: true });
  assert.equal(transientCalls, 2);

  let permanentCalls = 0;
  const permanentFetch = async (): Promise<Response> => {
    permanentCalls += 1;
    return new Response('bad request', { status: 400, statusText: 'Bad Request' });
  };
  await assert.rejects(
    fetchJson('https://itunes.apple.com/search', {}, {
      retries: 3,
      pace: false,
      fetchImpl: permanentFetch,
      sleep: async () => undefined,
    }),
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );
  assert.equal(permanentCalls, 1);
});

test('fetchJson rejects invalid JSON without repeating a successful HTTP response', async () => {
  let calls = 0;
  await assert.rejects(fetchJson('https://itunes.apple.com/search', {}, {
    retries: 3,
    pace: false,
    fetchImpl: async () => {
      calls += 1;
      return new Response('<html>not json</html>', { status: 200 });
    },
    sleep: async () => undefined,
  }), /invalid JSON/);
  assert.equal(calls, 1);
});
