export type GameStatus = "lobby" | "playing" | "won" | "lost";
export interface GameMember { id: string; label: string; color: string }
export interface GameRoomSnapshot {
  code: string;
  status: GameStatus;
  revision: number;
  round: number;
  hostId: string;
  meId: string | null;
  meCardSerial: string | null;
  members: GameMember[];
  lit: number[];
  startedAt: number | null;
  endsAt: number | null;
  total: 24;
  serverNow: number;
  expiresAt: number;
}
export type GameAction =
  | { action: "create"; token?: string }
  | { action: "join"; code: string; token?: string }
  | { action: "start" | "leave" | "restart"; code: string }
  | { action: "light"; code: string; bulb: number };
export interface GameResponse { room: GameRoomSnapshot }
export interface GameMemory { wins: number; lastCompletedAt: string | null }
export const GAME_TOTAL_BULBS = 24;
export const GAME_ROUND_SECONDS = 60;
export const GAME_MAX_MEMBERS = 6;
export const GAME_MEMBER_COLORS = ["#d96050", "#6b9b79", "#e7b85e", "#83a9bc", "#c48ba3", "#b49bc1"] as const;
