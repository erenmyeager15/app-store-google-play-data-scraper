import { Actor, log } from 'apify';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { lookupAppStore, searchAppStore } from './appstore.js';
import { lookupGooglePlay, searchGooglePlay } from './googleplay.js';
import type { ActorInput, AppRecord, NormalizedInput, SourceName } from './types.js';
import { normalizeText, uniqueStrings } from './utils.js';

const CHARGE_EVENT = 'app-scraped';
const DEFAULT_SOURCES: SourceName[] = ['app_store', 'google_play'];
const SOURCE_SET = new Set<SourceName>(DEFAULT_SOURCES);
const DEFAULT_USER_AGENT = 'AppStoreGooglePlayDataScraper/1.0 app-market-research';
type ProxyInput = NonNullable<ActorInput['proxyConfiguration']>;

function normalizeSources(values: unknown): SourceName[] {
  if (!Array.isArray(values)) return DEFAULT_SOURCES;
  const sources = values
    .map((source) => normalizeText(source))
    .filter((source): source is SourceName => source !== null && SOURCE_SET.has(source as SourceName));
  return sources.length > 0 ? [...new Set(sources)] : DEFAULT_SOURCES;
}

function normalizeList(values: unknown): string[] {
  return Array.isArray(values) ? uniqueStrings(values) : [];
}

function normalizeInput(rawInput: ActorInput): NormalizedInput {
  const country = (normalizeText(rawInput.country) ?? 'us').toLowerCase();
  return {
    sources: normalizeSources(rawInput.sources),
    searchQueries: normalizeList(rawInput.searchQueries),
    appIds: normalizeList(rawInput.appIds),
    packageNames: normalizeList(rawInput.packageNames),
    country,
    language: (normalizeText(rawInput.language) ?? 'en').toLowerCase(),
    includeRatingsSummary: rawInput.includeRatingsSummary !== false,
    maxResults: Math.min(Math.max(Number(rawInput.maxResults ?? 10), 1), 1000),
    userAgent: normalizeText(rawInput.userAgent) ?? DEFAULT_USER_AGENT,
    proxyConfiguration: rawInput.proxyConfiguration,
  };
}

async function buildGoogleRequestOptions(input: NormalizedInput): Promise<Record<string, unknown>> {
  const defaultProxy: ProxyInput =
    process.env.APIFY_IS_AT_HOME === '1'
      ? { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'], apifyProxyCountry: input.country.toUpperCase() }
      : { useApifyProxy: false };
  const proxyInput: ProxyInput = input.proxyConfiguration ?? defaultProxy;
  if (!proxyInput.useApifyProxy && !proxyInput.proxyUrls?.length) return {};

  try {
    const proxyConfiguration = await Actor.createProxyConfiguration(proxyInput);
    const proxyUrl = await proxyConfiguration?.newUrl();
    if (!proxyUrl) return {};
    const agent = new HttpsProxyAgent(proxyUrl);
    log.info('Google Play requests will use proxy configuration.');
    return { agent: { https: agent, http: agent } };
  } catch (error) {
    log.warning(`Proxy configuration unavailable; continuing without proxy: ${(error as Error).message}`);
    return {};
  }
}

function hasForbiddenField(record: AppRecord): boolean {
  const forbidden = /(reviewer|userName|developerEmail|email|phone|contact)/i;
  return Object.keys(record).some((key) => forbidden.test(key));
}

async function pushAndCharge(record: AppRecord): Promise<boolean> {
  if (hasForbiddenField(record)) {
    log.warning(`Skipped record with forbidden field name: ${record.source}:${record.appId}`);
    return true;
  }

  await Actor.pushData(record);
  const chargeResult = await Actor.charge({ eventName: CHARGE_EVENT });
  if (chargeResult.eventChargeLimitReached) {
    log.warning('User spending limit reached after saving the last clean app record. Stopping.');
    return false;
  }
  return true;
}

async function emitRecords(records: AppRecord[], seen: Set<string>, state: { saved: number; continue: boolean }, maxResults: number): Promise<void> {
  for (const record of records) {
    if (!state.continue || state.saved >= maxResults) return;
    const key = `${record.source}:${record.appId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    state.continue = await pushAndCharge(record);
    state.saved += 1;
  }
}

await Actor.init();

try {
  const input = normalizeInput((await Actor.getInput<ActorInput>()) ?? {});
  if (input.searchQueries.length === 0 && input.appIds.length === 0 && input.packageNames.length === 0) {
    input.searchQueries.push('whatsapp');
    input.appIds.push('310633997');
    input.packageNames.push('com.whatsapp');
  }

  log.info('Starting App Store & Google Play Data Scraper', {
    sources: input.sources,
    country: input.country,
    language: input.language,
    maxResults: input.maxResults,
  });

  const seen = new Set<string>();
  const state = { saved: 0, continue: true };
  const perSourceBudget = Math.max(1, Math.ceil(input.maxResults / input.sources.length));
  const googleRequestOptions = input.sources.includes('google_play') ? await buildGoogleRequestOptions(input) : {};

  for (const source of input.sources) {
    if (!state.continue || state.saved >= input.maxResults) break;
    let sourceSavedBefore = state.saved;

    if (source === 'app_store') {
      if (input.appIds.length > 0) {
        const records = await lookupAppStore(input.appIds, perSourceBudget, input.country, input.language, input.includeRatingsSummary, input.userAgent);
        await emitRecords(records, seen, state, input.maxResults);
      }
      for (const query of input.searchQueries) {
        if (!state.continue || state.saved - sourceSavedBefore >= perSourceBudget) break;
        const remaining = Math.min(perSourceBudget - (state.saved - sourceSavedBefore), input.maxResults - state.saved);
        const records = await searchAppStore(query, remaining, input.country, input.language, input.includeRatingsSummary, input.userAgent);
        await emitRecords(records, seen, state, input.maxResults);
      }
    }

    if (source === 'google_play') {
      sourceSavedBefore = state.saved;
      if (input.packageNames.length > 0) {
        const records = await lookupGooglePlay(
          input.packageNames,
          perSourceBudget,
          input.country,
          input.language,
          input.includeRatingsSummary,
          googleRequestOptions,
        );
        await emitRecords(records, seen, state, input.maxResults);
      }
      for (const query of input.searchQueries) {
        if (!state.continue || state.saved - sourceSavedBefore >= perSourceBudget) break;
        const remaining = Math.min(perSourceBudget - (state.saved - sourceSavedBefore), input.maxResults - state.saved);
        const records = await searchGooglePlay(query, remaining, input.country, input.language, input.includeRatingsSummary, googleRequestOptions);
        await emitRecords(records, seen, state, input.maxResults);
      }
    }
  }

  log.info(`Finished. Saved ${state.saved} clean non-personal app records.`);
} finally {
  await Actor.exit();
}
