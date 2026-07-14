import type { AppRecord } from './types.js';

export interface PushDataResult {
  chargedCount: number;
  eventChargeLimitReached: boolean;
}

export type PushRecord = (record: AppRecord) => Promise<PushDataResult>;

export async function pushUniqueRecords(
  records: AppRecord[],
  seen: Set<string>,
  maximumToSave: number,
  pushRecord: PushRecord,
): Promise<{ saved: number; stoppedByChargeLimit: boolean }> {
  let saved = 0;
  for (const record of records) {
    if (saved >= maximumToSave) break;
    if (seen.has(record.recordKey)) continue;
    const result = await pushRecord(record);
    const recordWasSaved = result.chargedCount > 0 || !result.eventChargeLimitReached;
    if (recordWasSaved) {
      seen.add(record.recordKey);
      saved += 1;
    }
    if (result.eventChargeLimitReached) return { saved, stoppedByChargeLimit: true };
  }
  return { saved, stoppedByChargeLimit: false };
}

export function allocateBudget(remainingRecords: number, remainingUnits: number): number {
  if (remainingRecords <= 0 || remainingUnits <= 0) return 0;
  return Math.max(1, Math.ceil(remainingRecords / remainingUnits));
}
