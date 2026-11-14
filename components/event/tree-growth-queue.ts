export type GrowthBatch = { requestId: string; count: number };
export type GrowthSnapshot = { playerId: string; waiting: number; batch: GrowthBatch | null; nextAt: number };
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Transaction = <T>(work: () => T | Promise<T>) => Promise<T>;

/** All shared-storage reads and writes happen inside the supplied transaction. */
export class GrowthQueue {
  constructor(private readonly key: string, private readonly playerId: string, private readonly storage: StorageLike, private readonly transaction: Transaction, private readonly makeId: () => string, private readonly now: () => number = Date.now) {}
  private read(): GrowthSnapshot {
    const empty: GrowthSnapshot = { playerId: this.playerId, waiting: 0, batch: null, nextAt: 0 };
    try {
      const data = JSON.parse(this.storage.getItem(this.key) || "null") as Partial<GrowthSnapshot> | null;
      if (!data || data.playerId !== this.playerId) return empty;
      const waiting = Number.isInteger(data.waiting) ? Math.max(0, Math.min(24, data.waiting!)) : 0;
      const batch = data.batch && /^[\w-]{8,80}$/.test(data.batch.requestId) && Number.isInteger(data.batch.count) && data.batch.count >= 1 && data.batch.count <= 12 ? { ...data.batch } : null;
      const nextAt = typeof data.nextAt === "number" ? Math.max(0, Math.min(this.now() + 60000, data.nextAt)) : 0;
      return { playerId: this.playerId, waiting, batch, nextAt };
    } catch { return empty; }
  }
  private write(snapshot: GrowthSnapshot) { this.storage.setItem(this.key, JSON.stringify(snapshot)); }
  refresh() { return this.transaction(() => this.read()); }
  enqueue() { return this.transaction(() => {
    const snapshot = this.read();
    if (snapshot.waiting + (snapshot.batch?.count || 0) >= 24) return { snapshot, accepted: false };
    snapshot.waiting += 1; this.write(snapshot); return { snapshot, accepted: true };
  }); }
  take() { return this.transaction(() => {
    const snapshot = this.read();
    if (snapshot.batch) return { snapshot, batch: { ...snapshot.batch }, waitMs: 0 };
    if (!snapshot.waiting) return { snapshot, batch: null, waitMs: 0 };
    if (snapshot.nextAt > this.now()) return { snapshot, batch: null, waitMs: snapshot.nextAt - this.now() };
    const count = Math.min(3, snapshot.waiting); snapshot.waiting -= count;
    snapshot.batch = { requestId: this.makeId(), count }; snapshot.nextAt = this.now() + 1000;
    this.write(snapshot); return { snapshot, batch: { ...snapshot.batch }, waitMs: 0 };
  }); }
  acknowledge(requestId: string) { return this.transaction(() => {
    const snapshot = this.read();
    // Another tab may already have acknowledged this batch and selected a new one.
    if (snapshot.batch?.requestId === requestId) { snapshot.batch = null; this.write(snapshot); }
    return snapshot;
  }); }
  clear() { return this.transaction(() => {
    let owner: string | undefined;
    try { owner = (JSON.parse(this.storage.getItem(this.key) || "null") as GrowthSnapshot | null)?.playerId; } catch {}
    if (owner === this.playerId) this.storage.removeItem(this.key);
    return { playerId: this.playerId, waiting: 0, batch: null, nextAt: 0 } satisfies GrowthSnapshot;
  }); }
}
