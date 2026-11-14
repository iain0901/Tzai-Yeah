export interface LocalUser { id: string; email: string; name: string; role: 'admin' | 'member' }
export class AuthError extends Error { status: number; code: string; constructor(status: number, message: string, code?: string); }
export function publicOrigin(): string;
export function getSessionSecret(): string;
export function hashPassword(password: string): Promise<string>;
export function verifyPassword(password: unknown, hash: unknown): Promise<boolean>;
export function createLocalUser(input: { email: string; name: string; password: string; role?: 'admin' | 'member' }): Promise<LocalUser>;
export function setUserPassword(input: { email: string; password: string }): Promise<LocalUser>;
export function getSessionUser(requestOrHeaders: Request | Headers | { get(name: string): string | null }): LocalUser | null;
export function safeReturnPath(value: unknown): string;
export function assertAuthOrigin(request: Request): void;
export function handleAuth(request: Request): Promise<Response>;
