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
      <div
        class="todo-bucket"
        data-bucket="later"
        :class="{ 'drop-end': insert?.bucket === 'later' && insert.beforeId === null }"
      >
        <div class="section-label">以后</div>
        <TodoRow
          v-for="t in later"
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
import { computed, ref } from "vue";
import TodoRow from "@/components/TodoRow.vue";
import { localDate } from "@/dates";
import { edgeScrollDelta, insertIndex, pickDragBucket, type BucketZones, type PlanBucket } from "@/todo-drag";
import { partitionTodos, todoWhen } from "@/todos";
import type { Project, Todo } from "@/types";

const props = defineProps<{ todos: Todo[]; projects?: Project[] }>();
const emit = defineEmits<{
  toggle: [id: string];
  remove: [id: string];
  move: [id: string, when: PlanBucket, index: number];
}>();

const projectTitles = computed(() => new Map((props.projects ?? []).map((p) => [p.id, p.title])));

const openId = ref<string | null>(null);
const liftId = ref<string | null>(null);
const insert = ref<{ bucket: PlanBucket; beforeId: string | null } | null>(null);
const ghost = ref<{ title: string; top: number } | null>(null);
const reduceMotion = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const scrollEl = ref<HTMLElement | null>(null);

const buckets = computed(() => partitionTodos(props.todos, localDate()));
const today = computed(() => buckets.value.today);
const later = computed(() => buckets.value.later);
const doneToday = computed(() => buckets.value.doneToday);
const doneTodayPlan = computed(() => doneToday.value.filter((t) => todoWhen(t) === "today"));

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

// 量出桶内各行的纵向中点，算出手指落在第几个空位（不含被拖的行）。
function measureInsert(bucket: PlanBucket, clientY: number, dragId: string) {
  const box = scrollEl.value?.querySelector(`[data-bucket=${bucket}]`);
  const rows = box
    ? [...box.querySelectorAll<HTMLElement>("[data-todo]")].filter((el) => el.dataset.todo !== dragId)
    : [];
  const midpoints = rows.map((el) => {
    const rect = el.getBoundingClientRect();
    return rect.top + rect.height / 2;
  });
  const index = insertIndex(clientY, midpoints);
  return { bucket, index, beforeId: rows[index]?.dataset.todo ?? null };
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
  if (bucket === from) {
    const origin = buckets.value[from].findIndex((t) => t.id === id);
    if (origin < 0 || target.index === origin) return;
  }
  emit("move", id, bucket, target.index);
}
</script>
