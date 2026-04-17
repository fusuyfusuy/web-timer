import { z } from "zod";

export const PauseIntervalSchema = z.object({
  pausedAt: z.number().int().nonnegative(),
  resumedAt: z.number().int().nonnegative().nullable(),
});
export type PauseInterval = z.infer<typeof PauseIntervalSchema>;

export const SessionSchema = z
  .object({
    startedAt: z.number().int().nonnegative(),
    endedAt: z.number().int().nonnegative().nullable(),
    pauses: z.array(PauseIntervalSchema).default([]),
  })
  .refine(
    (s) => s.endedAt === null || s.endedAt >= s.startedAt,
    { message: "endedAt must be >= startedAt when not null" },
  );

export type Session = z.infer<typeof SessionSchema>;

export const OpenSessionSchema = SessionSchema.and(
  z.object({ endedAt: z.null() }),
);
export type OpenSession = z.infer<typeof OpenSessionSchema>;

export const ClosedSessionSchema = z.object({
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative(),
  pauses: z.array(PauseIntervalSchema).default([]),
});
export type ClosedSession = z.infer<typeof ClosedSessionSchema>;
