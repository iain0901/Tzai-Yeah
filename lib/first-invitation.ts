const INTRO_SEEN_KEY = "tzai-invitation-seen-v1";

/** Returns true once per browser; direct game/edit links are never interrupted. */
export function startFirstInvitation(storage: Pick<Storage, "getItem" | "setItem">, search: string, phase: string, demo: boolean): boolean {
  if (demo || phase !== "before") return false;
  const params = new URLSearchParams(search);
  if (params.get("play") === "1" || params.get("edit") === "1") return false;
  try {
    if (storage.getItem(INTRO_SEEN_KEY) === "1") return false;
    storage.setItem(INTRO_SEEN_KEY, "1");
  } catch {
    // Private browsing may block storage; still show the invitation this visit.
  }
  return true;
}
