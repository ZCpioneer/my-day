import { reactive } from "vue";
import { titlesOverlap } from "../norm";
import { newId } from "../ids";
import type { DebugEntry } from "../types";

export const MAX_DEBUG_DETAIL = 500;

function clip(s: string): string {
  return s.length > MAX_DEBUG_DETAIL ? s.slice(0, MAX_DEBUG_DETAIL) : s;
}

export const debugLog = reactive({
  entries: [] as DebugEntry[],
  push(e: Omit<DebugEntry, "id" | "time">) {
    this.entries.push({
      id: newId(),
      time: new Date().toISOString(),
      ...e,
      detail: clip(e.detail),
    });
  },
  clear() {
    this.entries.splice(0, this.entries.length);
  },
  toText(): string {
    return this.entries
      .map((e) => {
        const bits = [e.time, e.event];
        if (e.status != null) bits.push(`status=${e.status}`);
        if (e.durationMs != null) bits.push(`${e.durationMs}ms`);
        if (e.model) bits.push(e.model);
        if (e.tool) bits.push(e.tool);
        bits.push(e.detail);
        return bits.join(" | ");
      })
      .join("\n");
  },
});

/** 候选里没留下来的标题。能对上留下来的更长标题时写成「旧 → 新」。 */
export function logDrops(tool: string, before: string[], after: string[]): void {
  const notes: string[] = [];
  for (const title of before) {
    if (!title || after.includes(title)) continue;
    const hit = after.find((kept) => titlesOverlap(kept, title));
    notes.push(hit ? `${title} → ${hit}` : title);
  }
  if (notes.length === 0) return;
  debugLog.push({ event: "dedupe", tool, detail: notes.join("；") });
}
