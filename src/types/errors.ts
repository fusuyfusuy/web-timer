// Error variants surfaced by transitions. Discriminated unions by `kind`.
import { z } from "zod";

export const StorageErrorKindSchema = z.enum([
  "StorageQuotaExceeded",
  "StorageUnavailable",
  "StorageReadUnavailable",
  "StorageWriteFailed",
  "CorruptStorageData",
  "SchemaVersionMismatch",
  "MultipleOpenSessions",
]);
export type StorageErrorKind = z.infer<typeof StorageErrorKindSchema>;

export interface StorageError {
  kind: StorageErrorKind;
  message: string;
  cause?: unknown;
}

export interface StorageWriteError extends StorageError {
  kind: "StorageWriteFailed" | "StorageQuotaExceeded";
  attempt: number; // 1 or 2 after retry
  reverted: boolean;
}

export const ValidationErrorKindSchema = z.enum([
  "EmptyName",
  "NameTooLong",
]);
export type ValidationErrorKind = z.infer<typeof ValidationErrorKindSchema>;

export interface ValidationError {
  kind: ValidationErrorKind;
  field: "name";
  message: string;
}

export interface TaskNotFoundError {
  kind: "TaskNotFound";
  taskId: string;
  message: string;
}

export interface NoOpenSessionError {
  kind: "NoOpenSession";
  taskId: string;
  message: string;
}

export interface AlreadyRunningOnSameTaskError {
  kind: "AlreadyRunningOnSameTask";
  taskId: string;
  message: string;
}

export type AppError =
  | StorageError
  | StorageWriteError
  | ValidationError
  | TaskNotFoundError
  | NoOpenSessionError
  | AlreadyRunningOnSameTaskError;
