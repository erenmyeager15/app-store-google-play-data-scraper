import { Actor, log } from 'apify';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { lookupAppStore, searchAppStore } from './appstore.js';
import { allocateBudget, pushUniqueRecords } from './billing.js';
import { lookupGooglePlay, searchGooglePlay } from './googleplay.js';
import { normalizeInput } from './input.js';
import { assertSafeRecord } from './recordSafety.js';
import { classifyRunOutcome } from './runOutcome.js';
import type {
  AppRecord,
  NormalizedInput,
  SourceJobResult,
  SourceName,
  SourceWarning,
} from './types.js';
import { safeErrorMessage } from './utils.js';

const CHARGE_EVENT = 'app-scraped';
const MAX_REPORTED_WARNINGS = 50;

interface SourceJob {
  source: SourceName;
  label: string;
  run: (limit: number) => Promise<SourceJobResult>;
}

interface GoogleRequestContext {
  requestOptions: Record<string, unknown>;
  close: () => void;
}

function proxyRequested(input: NormalizedInput): boolean {
  return Boolean(input.proxyConfiguration?.useApifyProxy || input.proxyConfiguration?.proxyUrls?.length);
}

async function createGoogleRequestContext(input: NormalizedInput): Promise<GoogleRequestContext> {
  const requestOptions: Record<string, unknown> = {
    timeout: { request: 25_000 },
    retry: { limit: 0 },
    headers: { 'user-agent': input.userAgent },
  };
  if (!proxyRequested(input)) return { requestOptions, close: () => undefined };

  const proxyConfiguration = await Actor.createProxyConfiguration(input.proxyConfiguration);
  const proxyUrl = await proxyConfiguration?.newUrl();
  if (!proxyUrl) throw new Error('Requested proxy configuration did not produce a proxy URL.');
  const agent = new HttpsProxyAgent(proxyUrl);
  requestOptions.agent = { http: agent, https: agent };
  log.info('Google Play requests will use the requested proxy configuration.');
  return { requestOptions, close: () => agent.destroy() };
}

function jobsForSource(
  input: NormalizedInput,
  source: SourceName,
  googleRequestOptions: Record<string, unknown>,
): SourceJob[] {
  if (source === 'app_store') {
    return [
      ...(input.appIds.length ? [{
        source,
        label: 'Apple app ID lookup',
        run: (limit: number) => lookupAppStore(
          input.appIds,
          limit,
          input.country,
          input.language,
          input.includeRatingsSummary,
          input.userAgent,
        ),
      }] : []),
      ...input.searchQueries.map((query): SourceJob => ({
        source,
        label: `Apple search: ${query}`,
        run: (limit) => searchAppStore(
          query,
          limit,
          input.country,
          input.language,
          input.includeRatingsSummary,
          input.userAgent,
        ),
      })),
    ];
  }

  return [
    ...(input.packageNames.length ? [{
      source,
      label: 'Google Play package lookup',
      run: (limit: number) => lookupGooglePlay(
        input.packageNames,
        limit,
        input.country,
        input.language,
        input.includeRatingsSummary,
        googleRequestOptions,
      ),
    }] : []),
    ...input.searchQueries.map((query): SourceJob => ({
      source,
      label: `Google Play search: ${query}`,
      run: (limit) => searchGooglePlay(
        query,
        limit,
        input.country,
        input.language,
        input.includeRatingsSummary,
        googleRequestOptions,
      ),
    })),
  ];
}

await Actor.init();
let googleContext: GoogleRequestContext | null = null;

try {
  const input = normalizeInput((await Actor.getInput<unknown>()) ?? {});
  googleContext = input.sources.includes('google_play')
    ? await createGoogleRequestContext(input)
    : { requestOptions: {}, close: () => undefined };

  log.info('Starting App Store & Google Play Data Scraper', {
    sources: input.sources,
    country: input.country,
    language: input.language,
    maxResults: input.maxResults,
  });

  const seen = new Set<string>();
  const warnings: SourceWarning[] = [];
  let warningCount = 0;
  let omittedWarnings = 0;
  let savedCount = 0;
  let attemptedJobs = 0;
  let successfulJobs = 0;
  let failedJobs = 0;
  let stoppedByChargeLimit = false;

  const addWarning = (warning: SourceWarning): void => {
    warningCount += 1;
    if (warnings.length < MAX_REPORTED_WARNINGS) warnings.push(warning);
    else omittedWarnings += 1;
    log.warning('App source warning', warning);
  };

  for (const [sourceIndex, source] of input.sources.entries()) {
    if (savedCount >= input.maxResults || stoppedByChargeLimit) break;
    const sourceJobs = jobsForSource(input, source, googleContext.requestOptions);
    const sourceTarget = allocateBudget(
      input.maxResults - savedCount,
      input.sources.length - sourceIndex,
    );
    let sourceSaved = 0;

    for (const [jobIndex, job] of sourceJobs.entries()) {
      if (sourceSaved >= sourceTarget || savedCount >= input.maxResults || stoppedByChargeLimit) break;
      const jobBudget = Math.min(
        allocateBudget(sourceTarget - sourceSaved, sourceJobs.length - jobIndex),
        input.maxResults - savedCount,
      );
      if (jobBudget <= 0) break;
      attemptedJobs += 1;

      let result: SourceJobResult;
      try {
        result = await job.run(jobBudget);
      } catch (error) {
        failedJobs += 1;
        addWarning({ source, operation: job.label, message: safeErrorMessage(error) });
        continue;
      }

      for (const message of result.warnings) {
        addWarning({ source, operation: job.label, message: safeErrorMessage(message) });
      }

      const safeRecords: AppRecord[] = [];
      for (const record of result.records) {
        try {
          safeRecords.push(assertSafeRecord(record));
        } catch (error) {
          addWarning({
            source,
            operation: job.label,
            message: `Skipped unsafe or malformed app record: ${safeErrorMessage(error)}`,
          });
        }
      }

      const fullyUnusable = result.outcome === 'failed'
        || (result.records.length > 0 && safeRecords.length === 0);
      if (fullyUnusable) {
        failedJobs += 1;
        continue;
      }
      successfulJobs += 1;

      // A dataset save failure is fatal. Retrying an ambiguous write could duplicate billing.
      const saveResult = await pushUniqueRecords(
        safeRecords,
        seen,
        Math.min(jobBudget, sourceTarget - sourceSaved, input.maxResults - savedCount),
        (record) => Actor.pushData(record, CHARGE_EVENT),
      );
      savedCount += saveResult.saved;
      sourceSaved += saveResult.saved;
      stoppedByChargeLimit = saveResult.stoppedByChargeLimit;
    }
  }

  const outcome = classifyRunOutcome({
    attemptedJobs,
    successfulJobs,
    warningCount,
    savedCount,
    stoppedByChargeLimit,
  });
  await Actor.setValue('RUN_SUMMARY', {
    generatedAt: new Date().toISOString(),
    outcome,
    savedCount,
    attemptedOperations: attemptedJobs,
    successfulOperations: successfulJobs,
    failedOperations: failedJobs,
    warningCount,
    omittedWarnings,
    stoppedByChargeLimit,
    sources: input.sources,
    country: input.country,
    language: input.language,
    warnings,
  });

  if (outcome === 'failed') {
    throw new Error(`All ${attemptedJobs} selected app-store operation(s) failed. See RUN_SUMMARY.`);
  }

  let statusMessage: string;
  if (stoppedByChargeLimit) {
    statusMessage = `Stopped at the user's spending limit after ${savedCount} app(s).`;
    log.warning(statusMessage);
  } else if (warningCount > 0) {
    statusMessage = `Finished with ${savedCount} app(s) and ${warningCount} source warning(s).`;
    log.warning(statusMessage);
  } else if (savedCount === 0) {
    statusMessage = 'Finished successfully: no matching apps were found.';
    log.info(statusMessage);
  } else {
    statusMessage = `Finished with ${savedCount} unique app record(s).`;
    log.info('App metadata scrape finished', { savedCount });
  }
  await Actor.setStatusMessage(statusMessage);
} catch (error) {
  const message = safeErrorMessage(error);
  log.exception(error as Error, 'App Store & Google Play actor failed');
  await Actor.fail(`Failed: ${message}`);
} finally {
  googleContext?.close();
}

await Actor.exit();
