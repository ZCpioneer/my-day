<template>
  <div class="todo-swipe" :class="{ open: revealed, slot: lifted, holding }" :data-todo="todo.id">
    <button class="todo-act" type="button" data-todo-group @click.stop="emit('group', todo.id)">分组</button>
    <button class="todo-del" type="button" data-todo-del @click.stop="emit('remove', todo.id)">删除</button>
    <div
      ref="itemEl"
      class="item"
      :class="{ done, dragging }"
      :style="{ transform: `translateX(${x}px)` }"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onCancel"
      @click="onClick"
      @contextmenu.prevent
    >
      <div class="box">{{ done ? "✓" : "" }}</div>
      <div>
        <p>{{ todo.title }}</p>
        <p v-if="todo.reason" class="todo-why">{{ todo.reason }}</p>
        <p v-if="meta" class="todo-meta" :class="{ hot: todo.priority === 'high', overdue }">{{ meta }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { localDate } from "@/dates";
import { HOLD_MS, movementCancelsHold } from "@/todo-drag";
import { isOverdue, todoMeta } from "@/todo-meta";
import type { Todo } from "@/types";

const BTN_W = 76;
const OPEN_X = -BTN_W * 2;

const props = defineProps<{
  todo: Todo;
  done?: boolean;
  revealed?: boolean;
  projectTitle?: string;
}>();

const meta = computed(() =>
  todoMeta(
    { priority: props.todo.priority, due: props.todo.due, estimate: props.todo.estimate, project: props.projectTitle },
    localDate(),
  ),
);
const overdue = computed(() => isOverdue(props.todo.due, localDate()));
const emit = defineEmits<{
  toggle: [id: string];
  remove: [id: string];
  reveal: [id: string | null];
  lift: [id: string];
  drag: [id: string, clientY: number];
  drop: [id: string, clientY: number];
  group: [id: string];
}>();

const x = ref(props.revealed ? OPEN_X : 0);
const dragging = ref(false);
const lifted = ref(false);
const holding = ref(false);
const itemEl = ref<HTMLElement | null>(null);
let startX = 0;
let startY = 0;
let lastY = 0;
let origin = 0;
let axis: "x" | "y" | null = null;
let swiped = false;
let didLift = false;
let pointerId: number | null = null;
let holdTimer: ReturnType<typeof setTimeout> | null = null;
let bound = false;

watch(
  () => props.revealed,
  (on) => {
    if (!dragging.value && !lifted.value) x.value = on ? OPEN_X : 0;
  },
);

onUnmounted(() => {
  clearHold();
  unbindGlobal();
});

function clearHold() {
  if (holdTimer !== null) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
}

function tapLiftFeedback() {
  try {
    navigator.vibrate?.(10);
  } catch {
    /* ignore */
  }
}

function onTouchMove(e: TouchEvent) {
  if (lifted.value) e.preventDefault();
}

function bindGlobal() {
  if (bound) return;
  bound = true;
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onCancel, true);
  window.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
}

function unbindGlobal() {
  if (!bound) return;
  bound = false;
  window.removeEventListener("pointermove", onMove, true);
  window.removeEventListener("pointerup", onUp, true);
  window.removeEventListener("pointercancel", onCancel, true);
  window.removeEventListener("touchmove", onTouchMove, true);
}

function onDown(e: PointerEvent) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  dragging.value = true;
  holding.value = !props.done;
  axis = null;
  swiped = false;
  didLift = false;
  lifted.value = false;
  startX = e.clientX;
  startY = e.clientY;
  lastY = e.clientY;
  origin = props.revealed ? OPEN_X : 0;
  pointerId = e.pointerId;
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture?.(e.pointerId);
  if (!props.done) el.style.touchAction = "none";
  bindGlobal();
  if (props.done) return;
  holdTimer = setTimeout(() => {
    holdTimer = null;
    if (pointerId === null) return;
    lifted.value = true;
    didLift = true;
    x.value = 0;
    emit("reveal", null);
    emit("lift", props.todo.id);
    tapLiftFeedback();
  }, HOLD_MS);
}

function onMove(e: PointerEvent) {
  if ((!dragging.value && !lifted.value) || e.pointerId !== pointerId) return;
  lastY = e.clientY;
  if (lifted.value) {
    e.preventDefault();
    emit("drag", props.todo.id, e.clientY);
    return;
  }
  const dx = e.clientX - startX;
  const dy = e.clientY - startY;
  if (!axis) {
    if (!movementCancelsHold(dx, dy)) return;
    clearHold();
    axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    if (axis === "y") {
      dragging.value = false;
      holding.value = false;
      x.value = origin;
      if (itemEl.value) itemEl.value.style.touchAction = "";
      itemEl.value?.releasePointerCapture?.(e.pointerId);
      unbindGlobal();
      pointerId = null;
      return;
    }
  }
  if (axis !== "x") return;
  e.preventDefault();
  swiped = true;
  x.value = Math.min(0, Math.max(OPEN_X, origin + dx));
}

function onCancel(e: PointerEvent) {
  if (pointerId === null || e.pointerId !== pointerId) return;
  if (lifted.value) return;
  onUp(e);
}

function onUp(e: PointerEvent) {
  if (pointerId === null || e.pointerId !== pointerId) return;
  clearHold();
  unbindGlobal();
  holding.value = false;
  if (itemEl.value) itemEl.value.style.touchAction = "";
  const y = e.clientY || lastY;
  if (lifted.value) {
    emit("drop", props.todo.id, y);
    lifted.value = false;
    dragging.value = false;
    pointerId = null;
    axis = null;
    x.value = 0;
    return;
  }
  const wasX = axis === "x";
  dragging.value = false;
  pointerId = null;
  axis = null;
  if (!wasX) {
    x.value = props.revealed ? OPEN_X : 0;
    return;
  }
  const open = x.value < OPEN_X / 2;
  x.value = open ? OPEN_X : 0;
  emit("reveal", open ? props.todo.id : null);
}

function onClick() {
  if (didLift) {
    didLift = false;
    return;
  }
  if (swiped) {
    swiped = false;
    return;
  }
  if (props.revealed) {
    emit("reveal", null);
    return;
  }
  emit("toggle", props.todo.id);
}
</script>
