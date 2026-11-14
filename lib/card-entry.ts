const KEY = "tzai:last-card";
type CardStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const valid = (token: string) => /^[a-f0-9]{48}$/.test(token);
export function rememberedCard(storage: CardStorage): string {
  try { const token = storage.getItem(KEY) || ""; return valid(token) ? token : ""; } catch { return ""; }
}
// A remembered public card link never grants profile editing or administrator access.
export function rememberCard(storage: CardStorage, token: string) {
  if (valid(token)) { try { storage.setItem(KEY, token); } catch {} }
}
export function forgetCard(storage: CardStorage, token: string) {
  try { if (storage.getItem(KEY) === token) storage.removeItem(KEY); } catch {}
}
