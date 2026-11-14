import type { EventConfig, Profile } from "../contracts";
export { DEFAULT_EVENT } from "../event-defaults";

export class ApiFault extends Error {
  constructor(public status: number, message: string, public code = "invalid_request") { super(message); }
}
export const EMPTY_PROFILE: Profile = { displayName: "", bio: "", url: "", mode: "page" };
export function textValue(value: unknown, label: string, max = 200, required = false): string {
  if (typeof value !== "string") {
    if (value == null && !required) return "";
    throw new ApiFault(400, `${label}格式不正確。`);
  }
  const result = value.trim();
  if (result.length > max || (required && !result)) throw new ApiFault(400, `${label}請填寫${required ? " 1～" : "不超過 "}${max} 個字。`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result)) throw new ApiFault(400, `${label}含有無法使用的字元。`);
  return result;
}
export function idValue(value: unknown): string | null {
  if (value === "" || value == null) return null;
  const id = textValue(value, "識別碼", 80, true);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new ApiFault(400, "識別碼格式不正確。");
  return id;
}
export function safeHttps(value: unknown, label = "連結"): string {
  const raw = textValue(value, label, 2048);
  if (!raw) return "";
  let url: URL;
  try { url = new URL(raw); } catch { throw new ApiFault(400, `${label}請使用完整的 https 網址。`); }
  if (url.protocol !== "https:" || url.username || url.password) throw new ApiFault(400, `${label}請使用完整的 https 網址。`);
  return url.href;
}
export function youtubeUrl(value: unknown): string {
  const raw = safeHttps(value, "預告影片");
  if (!raw) return "";
  const url = new URL(raw);
  if (!["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(url.hostname)) throw new ApiFault(400, "預告影片請填入 YouTube 影片網址。");
  const videoId = url.hostname === "youtu.be" ? url.pathname.slice(1).split("/")[0] : url.searchParams.get("v") || url.pathname.match(/^\/(?:shorts|embed)\/([\w-]+)/)?.[1];
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new ApiFault(400, "找不到 YouTube 影片代碼，請貼上單支影片的分享網址。");
  return `https://www.youtube.com/watch?v=${videoId}`;
}
export function parseProfile(value: unknown): Profile {
  const data = value as Record<string, unknown>;
  if (!data || typeof data !== "object") return { ...EMPTY_PROFILE };
  const mode = data.mode === "redirect" ? "redirect" : "page";
  const url = safeHttps(data.url);
  if (mode === "redirect" && !url) throw new ApiFault(400, "直接開啟連結模式需要先填寫網址。");
  return { displayName: textValue(data.displayName, "顯示名稱", 40), bio: textValue(data.bio, "自我介紹", 240), url, mode };
}
export function validateEvent(current: EventConfig, patch: unknown): EventConfig {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new ApiFault(400, "活動設定格式不正確。");
  const p = patch as Record<string, unknown>;
  const next = { ...current };
  for (const key of ["title", "subtitle", "theme", "venue", "address", "welcome", "afterMessage"] as const) {
    if (key in p) next[key] = textValue(p[key], "活動文字", 240, ["title", "theme", "venue"].includes(key));
  }
  if ("phase" in p) {
    if (!["before", "live", "after"].includes(String(p.phase))) throw new ApiFault(400, "活動階段不正確。");
    next.phase = p.phase as EventConfig["phase"];
  }
  if ("revealOpen" in p) {
    if (typeof p.revealOpen !== "boolean") throw new ApiFault(400, "揭曉設定不正確。");
    next.revealOpen = p.revealOpen;
  }
  if ("date" in p) {
    const value = textValue(p.date, "日期", 10, true);
    const date = new Date(`${value}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new ApiFault(400, "日期不存在或格式不正確。");
    next.date = value;
  }
  for (const key of ["doors", "start", "end"] as const) {
    if (key in p) {
      const value = textValue(p[key], "時間", 5, true);
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new ApiFault(400, "時間請使用 HH:MM 格式。");
      next[key] = value;
    }
  }
  if (!(next.doors <= next.start && next.start < next.end)) throw new ApiFault(400, "請確認入場、開始與結束時間的先後順序。");
  if ("videoUrl" in p) next.videoUrl = youtubeUrl(p.videoUrl);
  if ("albumUrl" in p) next.albumUrl = safeHttps(p.albumUrl, "相簿");
  if ("gallery" in p) {
    if (!Array.isArray(p.gallery) || p.gallery.length > 40) throw new ApiFault(400, "回顧照片最多 40 張。");
    next.gallery = p.gallery.map(item => {
      if (!item || typeof item !== "object") throw new ApiFault(400, "照片格式不正確。");
      const photo = item as Record<string, unknown>;
      const url = safeHttps(photo.url, "照片");
      if (!url) throw new ApiFault(400, "請填寫照片網址。");
      return { url, caption: textValue(photo.caption, "照片說明", 120) };
    });
  }
  return next;
}
export function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (/^[\s]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}
export function randomToken(bytes = 24): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(data, x => x.toString(16).padStart(2, "0")).join("");
}
export async function sha256(value: string): Promise<string> {
  const data = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(data), x => x.toString(16).padStart(2, "0")).join("");
}
