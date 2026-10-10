import { createHash } from 'node:crypto';
import type {
  AppMonitoringState,
  AppObservation,
  AppRecord,
} from './types.js';

const MINIMUM_RATE_INTERVAL_MS = 60 * 60 * 1000;

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function monitoringStoreName(monitorName: string): string {
  return `app-market-monitor-${hash(monitorName.trim().toLowerCase()).slice(0, 24)}`;
}

export function monitoringRecordKey(record: Pick<AppRecord, 'source' | 'appId' | 'country' | 'language'>): string {
  return `APP_${hash(`${record.source}:${record.appId}:${record.country}:${record.language}`).slice(0, 40)}`;
}

function observationFor(record: AppRecord): AppObservation {
  return {
    checkedAt: record.scrapedAt,
    price: record.price,
    currency: record.currency,
    ratingValue: record.ratingValue,
    ratingCount: record.ratingCount,
    installRange: record.installRange,
    version: record.version,
    lastUpdated: record.lastUpdated,
  };
}

function retainedObservation(current: AppObservation, previous: AppObservation | null): AppObservation {
  if (!previous) return current;
  return {
    ...current,
    price: current.price ?? previous.price,
    currency: current.currency ?? previous.currency,
    ratingValue: current.ratingValue ?? previous.ratingValue,
    ratingCount: current.ratingCount ?? previous.ratingCount,
    installRange: current.installRange ?? previous.installRange,
    version: current.version ?? previous.version,
    lastUpdated: current.lastUpdated ?? previous.lastUpdated,
  };
}

function valuesDiffer<T>(current: T | null, previous: T | null): boolean {
  return current !== null && previous !== null && current !== previous;
}

function meaningfulRatingCountDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  const delta = current - previous;
  const threshold = Math.max(1, Math.ceil(previous * 0.0001));
  return Math.abs(delta) >= threshold ? delta : null;
}

function rounded(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function daysSince(value: string | null, now: string): number | null {
  if (!value) return null;
  const elapsed = Date.parse(now) - Date.parse(value);
  return Number.isFinite(elapsed) ? rounded(Math.max(0, elapsed) / 86_400_000, 2) : null;
}

function isIncomplete(current: AppObservation, previous: AppObservation): boolean {
  const fields: (keyof AppObservation)[] = [
    'price',
    'currency',
    'ratingValue',
    'ratingCount',
    'installRange',
    'version',
    'lastUpdated',
  ];
  return fields.some((field) => previous[field] !== null && current[field] === null);
}

export interface MonitoringResult {
  record: AppRecord;
  nextState: AppMonitoringState;
}

export function applyMonitoring(
  record: AppRecord,
  previousState: AppMonitoringState | null,
  monitorName: string,
  historyLimit: number,
): MonitoringResult {
  const rawCurrent = observationFor(record);
  const previous = previousState?.history.at(-1) ?? null;
  const current = retainedObservation(rawCurrent, previous);
  const firstSeenAt = previousState?.firstSeenAt ?? record.scrapedAt;
  const observationCount = (previousState?.observationCount ?? 0) + 1;
  const changedFields: string[] = [];
  const growthSignals: string[] = [];
  let ratingCountDelta: number | null = null;
  let ratingsPerDay: number | null = null;

  if (previous) {
    if (valuesDiffer(rawCurrent.price, previous.price) || valuesDiffer(rawCurrent.currency, previous.currency)) {
      changedFields.push('price');
      if (rawCurrent.price !== null && previous.price !== null) {
        growthSignals.push(rawCurrent.price > previous.price ? 'price_increased' : 'price_decreased');
      } else {
        growthSignals.push('currency_changed');
      }
    }
    if (
      rawCurrent.ratingValue !== null
      && previous.ratingValue !== null
      && Math.abs(rawCurrent.ratingValue - previous.ratingValue) >= 0.0001
    ) {
      changedFields.push('ratingValue');
      growthSignals.push(rawCurrent.ratingValue > previous.ratingValue ? 'rating_increased' : 'rating_decreased');
    }
    ratingCountDelta = meaningfulRatingCountDelta(rawCurrent.ratingCount, previous.ratingCount);
    if (ratingCountDelta !== null) {
      changedFields.push('ratingCount');
      growthSignals.push(ratingCountDelta > 0 ? 'rating_volume_increased' : 'rating_volume_decreased');
    }
    if (valuesDiffer(rawCurrent.installRange, previous.installRange)) {
      changedFields.push('installRange');
      growthSignals.push('install_range_changed');
    }
    if (valuesDiffer(rawCurrent.version, previous.version)) {
      changedFields.push('version');
      growthSignals.push('new_version');
    }
    if (valuesDiffer(rawCurrent.lastUpdated, previous.lastUpdated)) {
      changedFields.push('lastUpdated');
      growthSignals.push('store_update_changed');
    }

    const elapsedMs = Date.parse(record.scrapedAt) - Date.parse(previous.checkedAt);
    if (ratingCountDelta !== null && elapsedMs >= MINIMUM_RATE_INTERVAL_MS) {
      ratingsPerDay = rounded(ratingCountDelta / (elapsedMs / 86_400_000), 2);
    }
  }

  const incomplete = previous ? isIncomplete(rawCurrent, previous) : false;
  const monitoringStatus = !previous
    ? 'baseline'
    : incomplete
      ? 'partial'
      : changedFields.length
        ? 'updated'
        : 'unchanged';
  const history = [...(previousState?.history ?? []), current].slice(-historyLimit);
  const previousPrice = previous?.price ?? null;
  const previousRatingValue = previous?.ratingValue ?? null;
  const priceDelta = rawCurrent.price !== null && previousPrice !== null
    ? rounded(rawCurrent.price - previousPrice)
    : null;
  const ratingValueDelta = rawCurrent.ratingValue !== null && previousRatingValue !== null
    ? rounded(rawCurrent.ratingValue - previousRatingValue)
    : null;

  return {
    record: {
      ...record,
      monitorName,
      monitoringStatus,
      firstSeenAt,
      previousSeenAt: previous?.checkedAt ?? null,
      observationCount,
      changedFields,
      previousPrice: previous?.price ?? null,
      priceDelta,
      priceChanged: previous ? changedFields.includes('price') : null,
      previousCurrency: previous?.currency ?? null,
      previousRatingValue: previous?.ratingValue ?? null,
      ratingValueDelta,
      previousRatingCount: previous?.ratingCount ?? null,
      ratingCountDelta,
      ratingsPerDay,
      previousInstallRange: previous?.installRange ?? null,
      previousVersion: previous?.version ?? null,
      versionChanged: previous ? changedFields.includes('version') : null,
      previousLastUpdated: previous?.lastUpdated ?? null,
      daysSinceStoreUpdate: daysSince(rawCurrent.lastUpdated, record.scrapedAt),
      growthSignals,
    },
    nextState: {
      schemaVersion: 1,
      firstSeenAt,
      observationCount,
      history,
    },
  };
}
