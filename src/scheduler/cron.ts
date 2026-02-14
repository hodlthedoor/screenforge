import { CronExpressionParser } from 'cron-parser';

const MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface CronValidation {
  valid: boolean;
  error?: string;
  nextRun?: Date;
}

export function validateCronExpression(expression: string, tier: string = 'free'): CronValidation {
  try {
    const interval = CronExpressionParser.parse(expression);
    const next = interval.next().toDate();

    // Check minimum interval for free tier
    if (tier === 'free') {
      const afterNext = interval.next().toDate();
      const gapMs = afterNext.getTime() - next.getTime();
      if (gapMs < MIN_INTERVAL_MS) {
        return {
          valid: false,
          error: 'Free tier schedules must have at least 5 minutes between runs',
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
