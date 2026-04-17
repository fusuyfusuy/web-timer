import { z } from "zod";
import { SessionSchema, type Session } from "./session";

export const TASK_NAME_MAX_LENGTH = 200;
export const PERSISTED_SCHEMA_VERSION = 2;
export const STORAGE_KEY = "webtimer:state:v1";
export const STORAGE_BACKUP_KEY = "webtimer:state:backup";

export const TaskIdSchema = z.string().min(1);
export type TaskId = z.infer<typeof TaskIdSchema>;

export const TaskNameSchema = z
  .string()
  .trim()
  .min(1, { message: "Task name must be non-empty" })
  .max(TASK_NAME_MAX_LENGTH, { message: `Task name must be <= ${TASK_NAME_MAX_LENGTH} chars` });

export const TimerModeSchema = z.enum(["countup", "countdown"]);
export type TimerMode = z.infer<typeof TimerModeSchema>;

export const TaskSchema = z.object({
  id: TaskIdSchema,
  name: TaskNameSchema,
  createdAt: z.number().int().nonnegative(),
  sessions: z.array(SessionSchema),
  timerMode: TimerModeSchema.default("countup"),
  countdownDurationMs: z.number().int().nonnegative().nullable().default(null),
  scheduledStartAt: z.number().int().nonnegative().nullable().default(null),
  scheduledEndAt: z.number().int().nonnegative().nullable().default(null),
});
export type Task = z.infer<typeof TaskSchema>;

export const PersistedStateSchema = z.object({
  schemaVersion: z.literal(PERSISTED_SCHEMA_VERSION),
  tasks: z.array(TaskSchema),
});
export type PersistedState = z.infer<typeof PersistedStateSchema>;

export interface TaskView {
  id: TaskId;
  name: string;
  createdAt: number;
  isRunning: boolean;
  isPaused: boolean;
  isCountdown: boolean;
  isExpired: boolean;
  totalMs: number;
  remainingMs: number | null;
  formattedTotal: string;
}

export type { Session };
