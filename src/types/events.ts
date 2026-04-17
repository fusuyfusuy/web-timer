import { z } from "zod";

export const StateNameSchema = z.enum([
  "booting",
  "idle",
  "error_validation",
  "error_corrupt",
  "error_schema_mismatch",
  "error_storage_unavailable",
  "error_storage_write",
  "error_task_not_found",
]);
export type StateName = z.infer<typeof StateNameSchema>;
