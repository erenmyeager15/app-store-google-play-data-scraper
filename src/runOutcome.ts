export type RunOutcome = 'failed' | 'charge_limit' | 'partial' | 'success' | 'empty';

export function classifyRunOutcome(input: {
  attemptedJobs: number;
  successfulJobs: number;
  warningCount: number;
  savedCount: number;
  stoppedByChargeLimit: boolean;
}): RunOutcome {
  if (input.attemptedJobs > 0 && input.successfulJobs === 0) return 'failed';
  if (input.stoppedByChargeLimit) return 'charge_limit';
  if (input.warningCount > 0) return 'partial';
  return input.savedCount > 0 ? 'success' : 'empty';
}
