// Statechart event names + state names. Must stay in sync with .mcd/statechart.mmd.
import { z } from "zod";

export const StateNameSchema = z.enum([
  "booting",
  "idle",
  "idle_running",
  "error_validation",
  "error_storage_write",
  "error_task_not_found",
  "error_corrupt",
  "error_storage_unavailable",
  "error_schema_mismatch",
]);
export type StateName = z.infer<typeof StateNameSchema>;

export const EventNameSchema = z.enum([
  // boot
  "BOOT_OK",
  "BOOT_OK_OPEN_SESSION",
  "BOOT_CORRUPT",
  "BOOT_STORAGE_UNAVAILABLE",
  "BOOT_SCHEMA_MISMATCH",
  "BOOT_MULTI_OPEN",
  // create
  "CREATE_TASK_OK",
  "CREATE_TASK_INVALID",
  "CREATE_TASK_STORAGE_FAIL",
  // start
  "START_TIMER",
  "START_TIMER_NOT_FOUND",
  "START_TIMER_SAME",
  "START_TIMER_STORAGE_FAIL",
  // stop
  "STOP_TIMER",
  "STOP_TIMER_NEGATIVE",
  "STOP_TIMER_NO_OPEN",
  "STOP_TIMER_STORAGE_FAIL",
  // delete
  "DELETE_TASK_OK",
  "DELETE_TASK_CANCELLED",
  "DELETE_TASK_STORAGE_FAIL",
  "DELETE_RUNNING_TASK",
  // tick
  "TICK",
  // error recovery
  "DISMISS_ERROR",
  "USER_RESET_CORRUPT",
  "USER_RESET_SCHEMA",
]);
export type EventName = z.infer<typeof EventNameSchema>;
