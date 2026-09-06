export const HOLD_MS = 450;
export const HOLD_SLOP = 8;
export const EDGE_PX = 36;

export type PlanBucket = "today" | "later";
export type BucketRange = { top: number; bottom: number };
export type BucketZones = { today: BucketRange; later: BucketRange };

export function movementCancelsHold(dx: number, dy: number): boolean {
  return Math.abs(dx) >= HOLD_SLOP || Math.abs(dy) >= HOLD_SLOP;
}

export function pickDragBucket(y: number, zones: BucketZones): PlanBucket | null {
  if (y >= zones.later.top && y < zones.later.bottom) return "later";
  if (y >= zones.today.top && y < zones.today.bottom) return "today";
  return null;
}

export function insertIndex(y: number, midpoints: number[]): number {
  let i = 0;
  while (i < midpoints.length && y > midpoints[i]) i++;
  return i;
}

export function edgeScrollDelta(y: number, view: BucketRange, edge: number = EDGE_PX): number {
  if (y < view.top + edge) return y - (view.top + edge);
  if (y > view.bottom - edge) return y - (view.bottom - edge);
  return 0;
}
