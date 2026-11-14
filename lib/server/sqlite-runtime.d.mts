import type { DatabaseSync } from "node:sqlite";
export interface SqlResult<T = Record<string, unknown>> {
  results: T[];
  success: true;
  meta: { changes: number; last_row_id: number };
}
export interface SqlPreparedStatement {
  bind(...values: unknown[]): SqlPreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
  run<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
}
export interface SqlDatabase {
  raw: DatabaseSync;
  filename: string;
  prepare(sql: string): SqlPreparedStatement;
  batch<T = Record<string, unknown>>(statements: SqlPreparedStatement[]): Promise<SqlResult<T>[]>;
  exec(sql: string): Promise<{ success: true }>;
  close(): void;
}
export function databasePath(): string;
export function createDatabase(options?: { filename?: string; migrationsDirectory?: string; migrate?: boolean }): SqlDatabase;
export function getDatabase(): SqlDatabase;
export function getRawDatabase(): DatabaseSync;
export function closeDatabase(): void;
export function backupDatabase(destination: string, options?: { database?: SqlDatabase; force?: boolean }): Promise<string>;
export function restoreDatabase(source: string, options?: { filename?: string; migrationsDirectory?: string; confirmStopped?: boolean; force?: boolean }): Promise<{ filename: string; previousBackup: string | null }>;
