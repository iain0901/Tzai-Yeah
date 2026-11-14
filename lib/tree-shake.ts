/** Pure, deterministic motion processing; no browser or clock access. */
export type MotionVector = { x: number | null; y: number | null; z: number | null };
type Vector = { x: number; y: number; z: number };
type Direction = -1 | 0 | 1;
export interface TreeMotionSample {
  at: number;
  acceleration?: MotionVector | null;
  includingGravity?: MotionVector | null;
  horizontalAxis?: "x" | "y";
}
export interface TreeShakeState {
  gravity: Vector | null;
  horizontal: number;
  lastAt: number | null;
  candidate: Direction;
  candidateAt: number;
  candidateCount: number;
  anchor: Direction;
  anchorAt: number;
  lastShakeAt: number | null;
}
export const TREE_SHAKE_THRESHOLD = 6;
export const TREE_SHAKE_COOLDOWN_MS = 350;

export function createTreeShakeState(): TreeShakeState {
  return { gravity: null, horizontal: 0, lastAt: null, candidate: 0, candidateAt: 0, candidateCount: 0, anchor: 0, anchorAt: 0, lastShakeAt: null };
}
function vector(value?: MotionVector | null): Vector | null {
  return value && typeof value.x === "number" && Number.isFinite(value.x)
    && typeof value.y === "number" && Number.isFinite(value.y)
    && typeof value.z === "number" && Number.isFinite(value.z)
    ? { x: value.x, y: value.y, z: value.z } : null;
}
function resetPeaks(state: TreeShakeState): TreeShakeState {
  return { ...state, horizontal: 0, candidate: 0, candidateCount: 0, anchor: 0 };
}

export function detectTreeShake(previous: TreeShakeState, sample: TreeMotionSample): { state: TreeShakeState; shake: boolean; usable: boolean } {
  const net = vector(sample.acceleration);
  const raw = vector(sample.includingGravity);
  if (!Number.isFinite(sample.at) || (!net && !raw)) return { state: previous, shake: false, usable: false };
  if (previous.lastAt !== null && sample.at <= previous.lastAt) return { state: previous, shake: false, usable: true };
  const elapsed = previous.lastAt === null ? 16 : sample.at - previous.lastAt;
  let state: TreeShakeState = { ...previous, lastAt: sample.at };
  if (elapsed > 400) state = { ...resetPeaks(state), gravity: null };
  const dt = Math.max(8, Math.min(120, elapsed));
  let linear = net;
  if (!linear && raw) {
    const magnitude = Math.hypot(raw.x, raw.y, raw.z);
    if (magnitude > 35 || magnitude < 1) return { state: resetPeaks(state), shake: false, usable: true };
    if (!state.gravity) {
      state.gravity = raw;
      return { state: resetPeaks(state), shake: false, usable: true };
    }
    const alpha = dt / (450 + dt);
    const gravity = {
      x: state.gravity.x + alpha * (raw.x - state.gravity.x),
      y: state.gravity.y + alpha * (raw.y - state.gravity.y),
      z: state.gravity.z + alpha * (raw.z - state.gravity.z),
    };
    state.gravity = gravity;
    // Pure tilting changes gravity's direction, but not its magnitude.
    // Require meaningful extra force before treating a raw sample as a shake.
    linear = Math.abs(magnitude - 9.80665) < .85
      ? { x: 0, y: 0, z: 0 }
      : { x: raw.x - gravity.x, y: raw.y - gravity.y, z: raw.z - gravity.z };
  }
  if (!linear || Math.hypot(linear.x, linear.y, linear.z) > 35) return { state: resetPeaks(state), shake: false, usable: true };
  const axis = sample.horizontalAxis || "x";
  const cross = axis === "x" ? linear.y : linear.x;
  const horizontal = linear[axis];
  const dominant = Math.abs(horizontal) >= Math.max(Math.abs(cross), Math.abs(linear.z)) * .8;
  const filtered = state.horizontal + dt / (35 + dt) * ((dominant ? horizontal : 0) - state.horizontal);
  state.horizontal = filtered;
  if (sample.at - state.anchorAt > 750) state.anchor = 0;
  const direction: Direction = filtered >= TREE_SHAKE_THRESHOLD ? 1 : filtered <= -TREE_SHAKE_THRESHOLD ? -1 : 0;
  if (!direction) {
    state.candidate = 0; state.candidateCount = 0;
    return { state, shake: false, usable: true };
  }
  if (state.candidate !== direction) {
    state.candidate = direction; state.candidateAt = sample.at; state.candidateCount = 1;
    return { state, shake: false, usable: true };
  }
  state.candidateCount += 1;
  if (state.candidateCount < 2 || sample.at - state.candidateAt < 12) return { state, shake: false, usable: true };
  if (state.anchor === direction) return { state, shake: false, usable: true };
  const reversalGap = sample.at - state.anchorAt;
  const reversed = state.anchor !== 0 && reversalGap >= 60 && reversalGap <= 750;
  const cooledDown = state.lastShakeAt === null || sample.at - state.lastShakeAt >= TREE_SHAKE_COOLDOWN_MS;
  const shake = reversed && cooledDown;
  // Consume a reversal even during the cooldown: holding still cannot later score.
  state.anchor = direction; state.anchorAt = sample.at;
  if (shake) state.lastShakeAt = sample.at;
  return { state, shake, usable: true };
}
