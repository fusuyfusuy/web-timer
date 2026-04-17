// Input/Output payload types referenced by statechart transitions.
import { z } from "zod";
import { TaskIdSchema, TaskNameSchema, TaskSchema, type Task, type TaskView } from "./task";

// ---- Create Task ----
export const TaskInputSchema = z.object({
  name: z.string(), // raw; will be trimmed/validated downstream
});
export type TaskInput = z.infer<typeof TaskInputSchema>;

export const ValidatedTaskInputSchema = z.object({
  name: TaskNameSchema,
});
export type ValidatedTaskInput = z.infer<typeof ValidatedTaskInputSchema>;

// ---- Start / Stop / Delete ----
export const StartTimerInputSchema = z.object({
  taskId: TaskIdSchema,
  now: z.number().int().nonnegative(),
});
export type StartTimerInput = z.infer<typeof StartTimerInputSchema>;

export const StopTimerInputSchema = z.object({
  taskId: TaskIdSchema,
  now: z.number().int().nonnegative(),
});
export type StopTimerInput = z.infer<typeof StopTimerInputSchema>;

export const DeleteTaskInputSchema = z.object({
  taskId: TaskIdSchema,
  confirmed: z.boolean(),
});
export type DeleteTaskInput = z.infer<typeof DeleteTaskInputSchema>;

export interface DeleteResult {
  deletedId: string;
  removed: boolean;
}

// ---- Boot / Hydrate ----
export interface BootInput {
  now: number;
  rawStorage: string | null;
}

export interface HydrateResult {
  tasks: Task[];
  hasActive: boolean;
}

export interface CorruptRecoveryResult {
  backupKey: string;
  promptMessage: string;
}

export interface MemoryOnlyResult {
  warning: string;
}

export interface SchemaMismatchResult {
  storedVersion: number | null;
  expectedVersion: number;
  promptMessage: string;
}

// ---- Tick / View ----
export interface TickInput {
  now: number;
}

export interface TickResult {
  views: TaskView[];
  hasActive: boolean;
}

// ---- Dismiss / Idle snapshot ----
export interface DismissInput {
  now: number;
}

export interface IdleSnapshot {
  tasks: Task[];
}

export { TaskSchema };
