<template>
  <section ref="rootEl" class="screen on">
    <div ref="scrollEl" class="todo-scroll" @scroll="onScroll">
      <div class="todo-head">
        <h2>今日</h2>
        <div class="todo-head-meta">
          <div class="count">{{ doneTodayPlan.length }} / {{ today.length + doneTodayPlan.length }}</div>
          <div class="todo-hint">左滑删除 · 长按拖动</div>
        </div>
      </div>
      <div
        class="todo-bucket"
        data-bucket="today"
        :class="{ 'drop-end': insert?.bucket === 'today' && insert.beforeId === null }"
      >
        <div class="section-label">今天</div>
        <TodoRow
          v-for="t in today"
          :key="t.id"
          :todo="t"
          :project-title="projectTitles.get(t.projectId ?? '')"
          :class="{ 'drop-before': insert?.bucket === 'today' && insert.beforeId === t.id }"
          :revealed="openId === t.id"
          @toggle="emit('toggle', $event)"
          @remove="emit('remove', $event)"
          @reveal="openId = $event"
          @lift="onLift"
          @drag="onDrag"
          @drop="onDrop"
        />
        <p v-if="today.length === 0" class="empty" style="margin: 8px 0">还没定今天做哪几件。</p>
      </div>
      <div class="todo-bucket" data-bucket="later">
        <div class="section-label">以后</div>
        <div
          v-for="section in laterSections"
          :key="section.project?.id ?? 'ungrouped'"
          class="todo-group"
          :data-group="section.project?.id ?? ''"
          :data-done="section.project?.status === 'done' ? '1' : undefined"
          :class="{
            'drop-end':
              insert?.bucket === 'later' &&
              insert.beforeId === null &&
              (insert.group ?? '') === (section.project?.id ?? ''),
          }"
        >
          <div
            class="group-head"
            :class="{ done: section.project?.status === 'done' }"
            @click="onGroupClick(section)"
          >
            <span class="group-name">{{ section.project?.title ?? "未分组" }}</span>
            <span v-if="section.project" class="group-progress">
              {{ section.doneCount }}/{{ section.totalCount }}
            </span>
            <span class="group-arrow">{{ isCollapsed(section) ? "▸" : "▾" }}</span>
          </div>
          <template v-if="!isCollapsed(section)">
            <TodoRow
              v-for="t in section.todos"
              :key="t.id"
              :todo="t"
              :project-title="projectTitles.get(t.projectId ?? '')"
              :class="{ 'drop-before': insert?.bucket === 'later' && insert.beforeId === t.id }"
              :revealed="openId === t.id"
              @toggle="emit('toggle', $event)"
              @remove="emit('remove', $event)"
              @reveal="openId = $event"
              @lift="onLift"
              @drag="onDrag"
              @drop="onDrop"
            />
          </template>
        </div>
        <p v-if="later.length === 0" class="empty" style="margin: 8px 0">没有记着的事。</p>
      </div>
      <div class="todo-bucket" data-bucket="done">
        <div class="section-label">已完成</div>
        <TodoRow
          v-for="t in doneToday"
          :key="t.id"
          :todo="t"
          :project-title="projectTitles.get(t.projectId ?? '')"
          done
          :revealed="openId === t.id"
          @toggle="emit('toggle', $event)"
          @remove="emit('remove', $event)"
          @reveal="openId = $event"
        />
        <p v-if="doneToday.length === 0" class="empty" style="margin: 8px 0">还没勾过。</p>
      </div>
    </div>
    <div
      v-if="ghost && !reduceMotion"
      class="todo-ghost"
      :style="{ top: ghost.top + 'px' }"
    >
      {{ ghost.title }}
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import TodoRow from "@/components/TodoRow.vue";
import { localDate } from "@/dates";
import { edgeScrollDelta, insertIndex, pickDragBucket, type BucketZones, type PlanBucket } from "@/todo-drag";
import { partitionLater, type LaterSection } from "@/todo-groups";
import { loadCollapsedGroups, saveCollapsedGroups } from "@/storage/settings";
import { partitionTodos, todoWhen } from "@/todos";
import type { Project, Todo } from "@/types";

const props = defineProps<{ todos: Todo[]; projects?: Project[] }>();
const emit = defineEmits<{
  toggle: [id: string];
  remove: [id: string];
  move: [id: string, when: PlanBucket, index: number, projectId?: string | null];
}>();

const projectTitles = computed(() => new Map((props.projects ?? []).map((p) => [p.id, p.title])));

const openId = ref<string | null>(null);
const liftId = ref<string | null>(null);
const insert = ref<{ bucket: PlanBucket; group: string | null; beforeId: string | null } | null>(null);
const ghost = ref<{ title: string; top: number } | null>(null);
const reduceMotion = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const scrollEl = ref<HTMLElement | null>(null);

const buckets = computed(() => partitionTodos(props.todos, localDate()));
const today = computed(() => buckets.value.today);
const later = computed(() => buckets.value.later);
const doneToday = computed(() => buckets.value.doneToday);
const doneTodayPlan = computed(() => doneToday.value.filter((t) => todoWhen(t) === "today"));

const laterSections = computed(() => partitionLater(props.todos, props.projects ?? []));

const collapsed = ref<Set<string>>(new Set());
onMounted(async () => {
  collapsed.value = new Set(await loadCollapsedGroups());
});

function sectionKey(s: LaterSection): string {
  return s.project?.id ?? "";
}

function isCollapsed(s: LaterSection): boolean {
  return collapsed.value.has(sectionKey(s));
}

async function onGroupClick(s: LaterSection) {
  if (liftId.value) return;
  const key = sectionKey(s);
  const next = new Set(collapsed.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  collapsed.value = next;
  await saveCollapsedGroups([...next]);
}

function onScroll() {
  if (!liftId.value) openId.value = null;
}

function preferReducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function measureZones(): BucketZones {
  const todayBox = scrollEl.value?.querySelector("[data-bucket=today]");
  const laterBox = scrollEl.value?.querySelector("[data-bucket=later]");
  const todayRect = todayBox?.getBoundingClientRect();
  const laterRect = laterBox?.getBoundingClientRect();
  return {
    today: { top: todayRect?.top ?? 0, bottom: todayRect?.bottom ?? 0 },
    later: { top: laterRect?.top ?? 0, bottom: laterRect?.bottom ?? 0 },
  };
}

function ghostTop(clientY: number) {
  const origin = rootEl.value?.getBoundingClientRect().top ?? 0;
  return clientY - origin;
}

// 量出落点：今天桶照旧按全桶行算；以后栏先命中分区（data-group），
// 落空处回被拖行自己的组（无组 = 未分组区），index 越界交给 applyMove 夹紧。
function measureInsert(bucket: PlanBucket, clientY: number, dragId: string) {
  const box = scrollEl.value?.querySelector(`[data-bucket=${bucket}]`);
  if (bucket === "today") {
    const rows = box
      ? [...box.querySelectorAll<HTMLElement>("[data-todo]")].filter((el) => el.dataset.todo !== dragId)
      : [];
    const midpoints = rows.map((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
    const index = insertIndex(clientY, midpoints);
    return { bucket, group: null, index, beforeId: rows[index]?.dataset.todo ?? null };
  }
  const groups = box ? [...box.querySelectorAll<HTMLElement>("[data-group]")] : [];
  const hit = groups.find((el) => {
    const rect = el.getBoundingClientRect();
    return clientY >= rect.top && clientY < rect.bottom;
  });
  if (!hit) {
    const dragged = props.todos.find((t) => t.id === dragId);
    return {
      bucket,
      group: dragged?.projectId ?? null,
      index: Number.MAX_SAFE_INTEGER,
      beforeId: null,
    };
  }
  const group = hit.dataset.group || null;
  const rows = [...hit.querySelectorAll<HTMLElement>("[data-todo]")].filter(
    (el) => el.dataset.todo !== dragId,
  );
  const midpoints = rows.map((el) => {
    const rect = el.getBoundingClientRect();
    return rect.top + rect.height / 2;
  });
  const index = insertIndex(clientY, midpoints);
  return { bucket, group, index, beforeId: rows[index]?.dataset.todo ?? null };
}

function onLift(id: string) {
  openId.value = null;
  liftId.value = id;
  reduceMotion.value = preferReducedMotion();
}

function onDrag(id: string, clientY: number) {
  if (liftId.value !== id) return;
  const bucket = pickDragBucket(clientY, measureZones());
  insert.value = bucket ? measureInsert(bucket, clientY, id) : null;
  const row = props.todos.find((t) => t.id === id);
  if (row && !reduceMotion.value) ghost.value = { title: row.title, top: ghostTop(clientY) };
  const box = scrollEl.value?.getBoundingClientRect();
  if (!box || !scrollEl.value) return;
  const delta = edgeScrollDelta(clientY, { top: box.top, bottom: box.bottom });
  if (delta) scrollEl.value.scrollTop += delta;
}

function onDrop(id: string, clientY: number) {
  const row = props.todos.find((t) => t.id === id);
  const bucket = pickDragBucket(clientY, measureZones());
  const target = bucket ? measureInsert(bucket, clientY, id) : null;
  liftId.value = null;
  ghost.value = null;
  insert.value = null;
  if (!row || !bucket || !target) return;
  const from = todoWhen(row);
  if (bucket === "today") {
    if (from === "today") {
      const origin = buckets.value.today.findIndex((t) => t.id === id);
      if (origin < 0 || target.index === origin) return;
    }
    emit("move", id, "today", target.index);
    return;
  }
  // 以后：同组同位置则不动
  if (from === "later" && (row.projectId ?? null) === target.group) {
    const lane = later.value.filter((t) => (t.projectId ?? null) === target.group);
    const origin = lane.findIndex((t) => t.id === id);
    if (origin < 0 || target.index === origin) return;
  }
  emit("move", id, "later", target.index, target.group);
}
</script>
