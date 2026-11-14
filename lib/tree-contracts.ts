export type TreeLevel = 1 | 2 | 3 | 4 | 5 | 6;
export interface TreePlayer {
  id: string;
  name: string;
  growth: number;
  heightCm: number;
  level: TreeLevel;
  rank: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface TreeResponse { player: TreePlayer | null; serverNow: number; awarded?: number }
export interface TreeLeaderboard {
  entries: TreePlayer[];
  page: number;
  pageSize: 5;
  total: number;
  myRank: number | null;
  player: TreePlayer | null;
  serverNow: number;
}
export type TreeAction =
  | { action: "register" | "rename"; name: string; token?: string }
  | { action: "grow"; count: number; requestId: string; token?: string };
export function treeLevel(growth: number): TreeLevel {
  return growth < 10 ? 1 : growth < 30 ? 2 : growth < 75 ? 3 : growth < 150 ? 4 : growth < 300 ? 5 : 6;
}
export function levelName(level: number): string {
  return ["小小樹苗", "冒出新芽", "枝葉初長", "綠意成蔭", "耶誕大樹", "星光巨樹"][Math.min(5, Math.max(0, Math.floor(level) - 1))] || "小小樹苗";
}
export function formatTreeHeight(heightCm: number): string {
  return heightCm >= 100 ? `${(heightCm / 100).toFixed(2)} m` : `${heightCm} cm`;
}
