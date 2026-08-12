import { z } from 'zod';

export const updateScheduleSchema = z.strictObject({
  lawId: z.uuid(),
  intervalMs: z
    .int()
    .positive()
    .max(31 * 24 * 60 * 60 * 1_000),
  nextCheckAt: z.iso.datetime(),
  consecutiveFailures: z.int().nonnegative(),
  nextRetryAt: z.iso.datetime().nullable(),
  suspendedUntil: z.iso.datetime().nullable(),
});

export type UpdateSchedule = z.infer<typeof updateScheduleSchema>;

export const calculateBackoffDelayMs = (options: {
  attempt: number;
  random: number;
  baseDelayMs?: number;
  maximumDelayMs?: number;
  jitterRatio?: number;
}): number => {
  const attempt = z.int().min(1).max(100).parse(options.attempt);
  const random = z.number().min(0).max(1).parse(options.random);
  const base = options.baseDelayMs ?? 60_000;
  const maximum = options.maximumDelayMs ?? 24 * 60 * 60 * 1_000;
  const jitterRatio = options.jitterRatio ?? 0.2;
  const exponential = Math.min(maximum, base * 2 ** Math.min(attempt - 1, 30));
  const jitter = exponential * jitterRatio * (random * 2 - 1);
  return Math.max(base, Math.min(maximum, Math.round(exponential + jitter)));
};

export const scheduleAfterSuccess = (schedule: UpdateSchedule, now: Date): UpdateSchedule =>
  updateScheduleSchema.parse({
    ...schedule,
    consecutiveFailures: 0,
    nextRetryAt: null,
    suspendedUntil: null,
    nextCheckAt: new Date(now.getTime() + schedule.intervalMs).toISOString(),
  });

export const scheduleAfterFailure = (options: {
  schedule: UpdateSchedule;
  now: Date;
  random: number;
  suspensionThreshold?: number;
  suspensionMs?: number;
}): UpdateSchedule => {
  const schedule = updateScheduleSchema.parse(options.schedule);
  const failures = schedule.consecutiveFailures + 1;
  const threshold = options.suspensionThreshold ?? 5;
  const retryAt = new Date(
    options.now.getTime() + calculateBackoffDelayMs({ attempt: failures, random: options.random }),
  ).toISOString();
  const suspendedUntil =
    failures >= threshold
      ? new Date(
          options.now.getTime() + (options.suspensionMs ?? 6 * 60 * 60 * 1_000),
        ).toISOString()
      : null;
  return updateScheduleSchema.parse({
    ...schedule,
    consecutiveFailures: failures,
    nextRetryAt: retryAt,
    nextCheckAt: retryAt,
    suspendedUntil,
  });
};

export const isScheduleDue = (schedule: UpdateSchedule, now: Date): boolean => {
  const parsed = updateScheduleSchema.parse(schedule);
  if (parsed.suspendedUntil !== null && Date.parse(parsed.suspendedUntil) > now.getTime())
    return false;
  return Date.parse(parsed.nextCheckAt) <= now.getTime();
};
