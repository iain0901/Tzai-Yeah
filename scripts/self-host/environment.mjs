import { existsSync } from 'node:fs';
import path from 'node:path';

export function loadEnvironment() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  process.env.PUBLIC_ORIGIN ||= 'http://localhost:3000';
  process.env.DATABASE_PATH = path.resolve(process.env.DATABASE_PATH || 'data/tzai.sqlite');
  process.env.SECRETS_DIR = path.resolve(process.env.SECRETS_DIR || 'secrets');
  process.env.SESSION_SECRET_FILE = path.resolve(process.env.SESSION_SECRET_FILE || path.join(process.env.SECRETS_DIR, 'session-secret'));
  // Standalone Next changes its working directory. Keep migrations/data anchored to this installation.
  process.env.MIGRATIONS_DIR = path.resolve(process.env.MIGRATIONS_DIR || 'drizzle');
  if (process.env.NFC_IMPORT_FILE) process.env.NFC_IMPORT_FILE = path.resolve(process.env.NFC_IMPORT_FILE);
}
