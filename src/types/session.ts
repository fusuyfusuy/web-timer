// Session — a single timed interval attached to a Task.
// Open if endedAt is null; closed otherwise with endedAt >= startedAt.
import { z } from "zod";

export const SessionSchema = z
  .object({
    startedAt: z.number().int().nonnegative(),
    endedAt: z.number().int().nonnegative().nullable(),
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
});
export type ClosedSession = z.infer<typeof ClosedSessionSchema>;
