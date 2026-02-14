import { CronExpressionParser } from 'cron-parser';

/** Minimum interval between runs per tier (in milliseconds) */
const TIER_MIN_INTERVALS: Record<string, { ms: number; label: string }> = {
  free: { ms: 24 * 60 * 60 * 1000, label: '24 hours' },
  starter: { ms: 60 * 60 * 1000, label: '1 hour' },
  pro: { ms: 15 * 60 * 1000, label: '15 minutes' },
  business: { ms: 5 * 60 * 1000, label: '5 minutes' },
};

export interface CronValidation {
  valid: boolean;
  error?: string;
  nextRun?: Date;
}

export function validateCronExpression(expression: string, tier: string = 'free'): CronValidation {
  try {
    const interval = CronExpressionParser.parse(expression);
    const next = interval.next().toDate();

    // Check minimum interval for the tier
    const tierLimit = TIER_MIN_INTERVALS[tier];
    if (tierLimit) {
      const afterNext = interval.next().toDate();
      const gapMs = afterNext.getTime() - next.getTime();
      if (gapMs < tierLimit.ms) {
        return {
          valid: false,
          error: `${tier.charAt(0).toUpperCase() + tier.slice(1)} tier schedules must have at least ${tierLimit.label} between runs`,
        };
      }
    }

    return { valid: true, nextRun: next };
  } catch {
    return { valid: false, error: 'Invalid cron expression' };
  }
}

export function getNextRun(expression: string, from?: Date): Date {
  const options = from ? { currentDate: from } : {};
  const interval = CronExpressionParser.parse(expression, options);
  return interval.next().toDate();
}
