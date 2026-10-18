<template>
  <section ref="rootEl" class="screen on">
    <div ref="scrollEl" class="todo-scroll" @scroll="onScroll">
      <div class="todo-head">
        <h2>今日</h2>
        <div class="todo-head-meta">
          <div class="count">{{ doneTodayPlan.length }} / {{ today.length + doneTodayPlan.length }}</div>
          <button
            class="todo-tidy"
            type="button"
            data-todo-tidy
            :disabled="awaiting"
            @click="emit('tidy')"
          >整理</button>
          <div class="todo-hint">点开可改 · 左滑移动/分组/删除 · 长按拖动</div>
        </div>
      </div>
      <div
        class="todo-bucket"
        data-bucket="today"
        :class="{ 'drop-end': insert?.bucket === 'today' && insert.beforeId === null }"
      >
        <div class="section-label">今天</div>
        <template v-if="overdue.length">
          <div class="section-label sub">逾期</div>
          <TodoRow
            v-for="t in overdue"
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
            @group="onRowGroup"
            @shift="onShift"
            @edit="onRowEdit"
          />
        </template>
        <TodoRow
          v-for="t in today"
          :key="t.id"
          :todo="t"
          :leftover="isLeftover(t, todayDate)"
          :project-title="projectTitles.get(t.projectId ?? '')"
          :class="{ 'drop-before': insert?.bucket === 'today' && insert.beforeId === t.id }"
          :revealed="openId === t.id"
          @toggle="emit('toggle', $event)"
          @remove="emit('remove', $event)"
          @reveal="openId = $event"
          @lift="onLift"
          @drag="onDrag"
          @drop="onDrop"
          @group="onRowGroup"
          @shift="onShift"
          @edit="onRowEdit"
        />
        <p v-if="today.length === 0 && overdue.length === 0" class="empty empty-cta">
          还没定今天做哪几件。
          <button type="button" data-empty-add-today @click="openAdd('today')">加上一件</button>
        </p>
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
              (insert?.bucket === 'later' &&
                insert.beforeId === null &&
                (insert.group ?? '') === (section.project?.id ?? '')) ||
              isGroupDropEnd(section),
          }"
        >
          <div
            class="group-head"
            :class="{ done: section.project?.status === 'done', 'drop-before': isGroupDropBefore(section) }"
            @click="onGroupClick(section)"
          >
            <span
              v-if="section.project && section.project.status !== 'done'"
              class="group-handle"
              data-group-handle
              @pointerdown="onGroupHandleDown(section.project.id, $event)"
              @click.stop
            >⠿</span>
            <span class="group-name">{{ section.project?.title ?? "未分组" }}</span>
            <span v-if="section.project && section.totalCount > 0" class="group-progress">
              {{ section.doneCount }}/{{ section.totalCount }}
            </span>
            <button
              v-if="section.project"
              class="group-menu"
              data-group-menu
              type="button"
              @click.stop="onGroupMenu(section)"
            >···</button>
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
              @group="onRowGroup"
              @shift="onShift"
              @edit="onRowEdit"
            />
          </template>
        </div>
        <button class="group-add" data-group-add type="button" @click="sheet = { mode: 'create' }">＋ 新建组</button>
        <p v-if="laterVisible === 0 && laterSections.length === 0" class="empty empty-cta">
          没有记着的事。
          <button type="button" data-empty-add-later @click="openAdd('later')">记一件</button>
        </p>
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
          @group="onRowGroup"
          @edit="onRowEdit"
        />
        <p v-if="doneToday.length === 0" class="empty" style="margin: 8px 0">还没勾过。</p>
      </div>
      <div v-if="(waitings ?? []).length" class="todo-bucket" data-bucket="waiting">
        <div class="section-label">在等</div>
        <div v-for="w in waitings" :key="w.id" class="waiting-row" :data-waiting="w.id">
          <div>
            <p>{{ w.text }}</p>
            <p v-if="w.waitingOn" class="todo-why">等{{ w.waitingOn }}</p>
          </div>
          <button type="button" data-waiting-done @click="emit('resolveWaiting', w.id)">等到了</button>
        </div>
      </div>
    </div>
    <div
      v-if="ghost && !reduceMotion"
      class="todo-ghost"
      :style="{ top: ghost.top + 'px' }"
    >
      {{ ghost.title }}
    </div>
    <button
      v-show="!liftId && !draft"
      class="todo-fab"
      type="button"
      data-todo-add
      aria-label="新增待办"
      @click="openAdd('today')"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
    <GroupSheet
      v-if="sheet"
      :mode="sheet.mode"
      :projects="projects ?? []"
      :current="sheetCurrent"
      :group="sheetGroup"
      :open-count="sheetOpenCount"
      @pick="onSheetPick"
      @rename="onSheetRename"
      @complete="onSheetComplete"
      @remove="onSheetDeleteGroup"
      @close="sheet = null"
    />
    <TodoDraftSheet
      v-if="draft"
      :mode="draft.mode"
      :projects="projects ?? []"
      :initial="draft.initial"
      @submit="onDraftSubmit"
      @close="draft = null"
    />
    <div v-if="pendingPropose?.length" class="sheet-mask" data-propose-sheet @click.self="emit('skip')">
      <div class="sheet propose-sheet">
        <TodoConfirm
          :items="pendingPropose"
          :heading="proposeKind === 'today' ? '这样排可以吗？' : '记到「以后」吗？'"
          :yes-label="proposeKind === 'today' ? '确认这次整理' : '确认记下'"
          :no-label="proposeKind === 'today' ? '先不定' : '这次不加'"
          :note="proposeKind === 'today' ? '确认后这段对话会清空，可以重新聊。' : undefined"
          :existing-projects="existingProjects ?? []"
          @confirm="emit('confirm', $event)"
          @skip="emit('skip')"
        />
      </div>
    </div>
    <div v-if="undoTitle" class="todo-undo" data-todo-undo>
      已删除「{{ undoTitle }}」
      <button type="button" data-todo-undo-btn @click="emit('undoRemove')">撤销</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import GroupSheet from "@/components/GroupSheet.vue";
import TodoConfirm from "@/components/TodoConfirm.vue";
import TodoDraftSheet from "@/components/TodoDraftSheet.vue";
import TodoRow from "@/components/TodoRow.vue";
import { localDate } from "@/dates";
import { edgeScrollDelta, HOLD_MS, insertIndex, movementCancelsHold, pickDragBucket, type BucketZones, type PlanBucket } from "@/todo-drag";
import { partitionLater, sortProjects, type LaterSection } from "@/todo-groups";
import { loadCollapsedGroups, saveCollapsedGroups } from "@/storage/settings";
import { isLeftover, isOverdueLater, partitionTodos, todoWhen } from "@/todos";
import type { Project, ProposedTodo, Todo, TodoDraft, Waiting } from "@/types";

const props = defineProps<{
  todos: Todo[];
  projects?: Project[];
  waitings?: Waiting[];
  pendingPropose?: ProposedTodo[] | null;
  proposeKind?: "later" | "today";
  existingProjects?: string[];
  undoTitle?: string | null;
  awaiting?: boolean;
  date?: string;
}>();
const emit = defineEmits<{
  toggle: [id: string];
  remove: [id: string];
  move: [id: string, when: PlanBucket, index: number, projectId?: string | null];
  moveGroup: [id: string, index: number];
  assign: [todoId: string, projectId: string | null, newTitle?: string];
  renameGroup: [id: string, title: string];
  completeGroup: [id: string, done: boolean];
  createGroup: [title: string];
  deleteGroup: [id: string];
  add: [draft: TodoDraft];
  update: [id: string, draft: TodoDraft];
  tidy: [];
  confirm: [items: ProposedTodo[]];
  skip: [];
  resolveWaiting: [id: string];
  undoRemove: [];
}>();

const projectTitles = computed(() => new Map((props.projects ?? []).map((p) => [p.id, p.title])));

const openId = ref<string | null>(null);
const sheet = ref<
  { mode: "assign"; todoId: string } | { mode: "manage"; project: Project } | { mode: "create" } | null
>(null);
const draft = ref<{ mode: "add" | "edit"; initial?: TodoDraft; editId?: string } | null>(null);

function openAdd(when: PlanBucket = "today") {
  sheet.value = null;
  draft.value = { mode: "add", initial: { title: "", when } };
}

function onRowEdit(id: string) {
  const t = props.todos.find((row) => row.id === id);
  if (!t) return;
  openId.value = null;
  draft.value = {
    mode: "edit",
    editId: id,
    initial: {
      title: t.title,
      when: todoWhen(t),
      projectId: t.projectId ?? null,
      due: t.due,
      estimate: t.estimate,
      priority: t.priority,
      reason: t.reason,
    },
  };
}

function onDraftSubmit(next: TodoDraft) {
  const editing = draft.value;
  draft.value = null;
  if (editing?.mode === "edit" && editing.editId) emit("update", editing.editId, next);
  else emit("add", next);
}

function onShift(id: string) {
  const row = props.todos.find((t) => t.id === id);
  if (!row) return;
  openId.value = null;
  const to = todoWhen(row) === "today" ? "later" : "today";
  if (to === "today") emit("move", id, "today", 0);
  else emit("move", id, "later", 0, row.projectId ?? null);
}

function openCountOf(pid: string): number {
  return props.todos.filter((t) => t.projectId === pid && t.status === "open").length;
}

// 模板里收窄不了 sheet 的联合类型，派生值统一在这里算好。
const sheetCurrent = computed(() => {
  const s = sheet.value;
  if (s?.mode !== "assign") return undefined;
  return props.todos.find((t) => t.id === s.todoId)?.projectId ?? null;
});
const sheetGroup = computed(() => {
  const s = sheet.value;
  return s?.mode === "manage" ? s.project : undefined;
});
const sheetOpenCount = computed(() => {
  const s = sheet.value;
  return s?.mode === "manage" ? openCountOf(s.project.id) : undefined;
});

function onGroupMenu(s: LaterSection) {
  if (s.project) sheet.value = { mode: "manage", project: s.project };
}

function onRowGroup(id: string) {
  openId.value = null;
  sheet.value = { mode: "assign", todoId: id };
}

function onSheetPick(projectId: string | null, newTitle?: string) {
  const s = sheet.value;
  sheet.value = null;
  if (s?.mode === "assign") emit("assign", s.todoId, projectId, newTitle);
  if (s?.mode === "create" && newTitle) emit("createGroup", newTitle);
}

function onSheetRename(title: string) {
  const s = sheet.value;
  sheet.value = null;
  if (s?.mode === "manage") emit("renameGroup", s.project.id, title);
}

function onSheetComplete(done: boolean) {
  const s = sheet.value;
  sheet.value = null;
  if (s?.mode === "manage") emit("completeGroup", s.project.id, done);
}

function onSheetDeleteGroup() {
  const s = sheet.value;
  sheet.value = null;
  if (s?.mode === "manage") emit("deleteGroup", s.project.id);
}
const liftId = ref<string | null>(null);
const insert = ref<{ bucket: PlanBucket; group: string | null; beforeId: string | null } | null>(null);
const ghost = ref<{ title: string; top: number } | null>(null);
const reduceMotion = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const scrollEl = ref<HTMLElement | null>(null);

const todayDate = computed(() => props.date ?? localDate());
const buckets = computed(() => partitionTodos(props.todos, todayDate.value));
const today = computed(() => buckets.value.today);
const later = computed(() => buckets.value.later);
const overdue = computed(() => later.value.filter((t) => isOverdueLater(t, todayDate.value)));
const laterVisible = computed(() => later.value.length - overdue.value.length);
const doneToday = computed(() => buckets.value.doneToday);
const doneTodayPlan = computed(() => doneToday.value.filter((t) => todoWhen(t) === "today"));

const laterSections = computed(() => partitionLater(props.todos, props.projects ?? [], todayDate.value));

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

const groupInsertBefore = ref<string | null>(null);
let groupDragId: string | null = null;
let groupTimer: ReturnType<typeof setTimeout> | null = null;
let groupStartX = 0;
let groupStartY = 0;
let groupPointer: number | null = null;

// 「进行中组之后第一个分区」的 key：落空时插入线画在它上方；没有就靠桶尾。
const groupEndKey = computed(() => {
  const secs = laterSections.value;
  const hit = secs.find((s) => s.project === null || s.project.status === "done");
  return hit ? sectionKey(hit) : null;
});

function measureGroupInsert(clientY: number, dragId: string): { index: number; beforeKey: string } {
  const movable = [...(scrollEl.value?.querySelectorAll<HTMLElement>("[data-group]") ?? [])].filter(
    (el) => el.dataset.group && el.dataset.group !== dragId && el.dataset.done !== "1",
  );
  const midpoints = movable.map((el) => {
    const rect = el.getBoundingClientRect();
    return rect.top + rect.height / 2;
  });
  const index = insertIndex(clientY, midpoints);
  const beforeKey = movable[index]?.dataset.group ?? (groupEndKey.value ?? "__end__");
  return { index, beforeKey };
}

function clearGroupDrag() {
  if (groupTimer !== null) {
    clearTimeout(groupTimer);
    groupTimer = null;
  }
  groupPointer = null;
  groupDragId = null;
  groupInsertBefore.value = null;
  window.removeEventListener("pointermove", onGroupPointerMove, true);
  window.removeEventListener("pointerup", onGroupPointerUp, true);
  window.removeEventListener("pointercancel", onGroupPointerUp, true);
}

function onGroupHandleDown(id: string, e: PointerEvent) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  groupStartX = e.clientX;
  groupStartY = e.clientY;
  groupPointer = e.pointerId;
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  groupTimer = setTimeout(() => {
    groupTimer = null;
    if (groupPointer === null) return;
    groupDragId = id;
    openId.value = null;
    try {
      navigator.vibrate?.(10);
    } catch {
      /* ignore */
    }
  }, HOLD_MS);
  window.addEventListener("pointermove", onGroupPointerMove, true);
  window.addEventListener("pointerup", onGroupPointerUp, true);
  window.addEventListener("pointercancel", onGroupPointerUp, true);
}

function onGroupPointerMove(e: PointerEvent) {
  if (groupPointer === null || e.pointerId !== groupPointer) return;
  if (!groupDragId) {
    // 拖动超过阈值 = 放弃长按，让位滚动
    if (movementCancelsHold(e.clientX - groupStartX, e.clientY - groupStartY)) {
      clearGroupDrag();
    }
    return;
  }
  e.preventDefault();
  const { beforeKey } = measureGroupInsert(e.clientY, groupDragId);
  groupInsertBefore.value = beforeKey;
}

function onGroupPointerUp(e: PointerEvent) {
  if (groupPointer === null || e.pointerId !== groupPointer) return;
  const dragId = groupDragId;
  if (dragId) {
    const { index, beforeKey } = measureGroupInsert(e.clientY, dragId);
    // 原位置不动：落点正好是自己原来的位置
    const lane = sortProjects(props.projects ?? []).filter((p) => p.status !== "done");
    const origin = lane.findIndex((p) => p.id === dragId);
    if (!(beforeKey === "__end__" ? index === lane.length - 1 && origin === lane.length - 1 : index === origin)) {
      emit("moveGroup", dragId, index);
    }
  }
  clearGroupDrag();
}

function isGroupDropBefore(s: LaterSection): boolean {
  const before = groupInsertBefore.value;
  if (before === null || before === "__end__") return false;
  return before === sectionKey(s);
}

// 落到进行中组末尾：线画在最后一组下方而不是上方。
function isGroupDropEnd(s: LaterSection): boolean {
  return groupInsertBefore.value === "__end__" && isLastActive(s);
}

function isLastActive(s: LaterSection): boolean {
  const actives = laterSections.value.filter((x) => x.project && x.project.status !== "done");
  return actives.at(-1)?.project?.id === s.project?.id;
}

onUnmounted(clearGroupDrag);

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
