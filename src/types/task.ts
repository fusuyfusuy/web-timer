// Task — a user-created unit of work owning a list of timer Sessions.
import { z } from "zod";
import { SessionSchema, type Session } from "./session";

export const TASK_NAME_MAX_LENGTH = 200;
export const PERSISTED_SCHEMA_VERSION = 1;
export const STORAGE_KEY = "webtimer:state:v1";
export const STORAGE_BACKUP_KEY = "webtimer:state:backup";

export const TaskIdSchema = z.string().min(1);
export type TaskId = z.infer<typeof TaskIdSchema>;

export const TaskNameSchema = z
  .string()
  .trim()
  .min(1, { message: "Task name must be non-empty" })
  .max(TASK_NAME_MAX_LENGTH, { message: `Task name must be <= ${TASK_NAME_MAX_LENGTH} chars` });

export const TaskSchema = z.object({
  id: TaskIdSchema,
  name: TaskNameSchema,
  createdAt: z.number().int().nonnegative(),
  sessions: z.array(SessionSchema),
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
  totalMs: number;
  formattedTotal: string; // HH:MM:SS
}

export type { Session };
