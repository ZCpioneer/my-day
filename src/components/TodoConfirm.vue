<template>
  <div class="msg agent propose">
    <div class="who">待确认</div>
    <div class="propose-shell">
      <div class="propose-core">
        <header>{{ heading }}</header>
        <p v-if="note" class="propose-note">{{ note }}</p>
        <template v-for="(s, si) in sections" :key="si">
          <p
            v-if="showWhen && (si === 0 || sections[si - 1].when !== s.when)"
            class="propose-group"
          >{{ s.when === "today" ? "今天" : "以后" }}</p>
          <p v-if="s.project" class="propose-sub">
            <label class="propose-sub-check">
              <input
                type="checkbox"
                :checked="s.idxs.every((i) => checked[i])"
                @change="toggleSection(s, $event)"
              />
              <span>{{ s.project }}<span v-if="s.isNew" class="propose-new">新</span></span>
            </label>
          </p>
          <template v-for="i in s.idxs" :key="`${s.when}-${s.project ?? ''}-${i}`">
            <div class="todo-pick-row">
              <label class="todo-pick">
                <input v-model="checked[i]" type="checkbox" />
                <span>
                  {{ draft[i].title }}
                  <span v-if="draft[i].reason" class="todo-why">{{ draft[i].reason }}</span>
                </span>
                <span v-if="metaFor(draft[i])" class="todo-meta">{{ metaFor(draft[i]) }}</span>
              </label>
              <button class="todo-adjust" type="button" @click="toggleAdjust(i)">
                {{ expanded === i ? "收起" : "调整" }}
              </button>
            </div>
            <div v-if="expanded === i" class="todo-edit">
              <label class="todo-edit-field">
                归属
                <select :value="projChoice(i)" @change="onProjChange(i, $event)">
                  <option value="">不分组</option>
                  <option v-for="p in projOptions(i)" :key="p" :value="p">{{ p }}</option>
                  <option value="__new__">＋ 新组…</option>
                </select>
              </label>
              <input
                v-if="projChoice(i) === '__new__'"
                class="todo-edit-new"
                type="text"
                placeholder="新组名"
                :value="draft[i].project ?? ''"
                @input="onNewName(i, $event)"
              />
              <label class="todo-edit-field">
                截止
                <input type="date" :value="dateOnly(draft[i].due)" @input="onDue(i, $event)" />
              </label>
              <label class="todo-edit-field">
                约
                <input
                  type="number"
                  min="0"
                  step="5"
                  placeholder="分钟"
                  :value="draft[i].estimate ?? ''"
                  @input="onEstimate(i, $event)"
                />
              </label>
              <label class="todo-edit-field todo-edit-hot">
                <input
                  type="checkbox"
                  :checked="draft[i].priority === 'high'"
                  @change="onPriority(i, $event)"
                />
                急
              </label>
            </div>
          </template>
        </template>
        <div class="propose-actions">
          <button class="btn-yes" type="button" @click="onConfirm">{{ yesLabel }}</button>
          <button class="btn-no" type="button" @click="emit('skip')">{{ noLabel }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { localDate } from "@/dates";
import { normKey } from "@/norm";
import { todoMeta } from "@/todo-meta";
import type { ProposedTodo } from "@/types";

const props = withDefaults(
  defineProps<{
    items?: ProposedTodo[];
    heading?: string;
    yesLabel?: string;
    noLabel?: string;
    note?: string;
    /** 已有项目标题，用来给新组打「新」标、给归属下拉提供候选。 */
    existingProjects?: string[];
  }>(),
  {
    items: () => [],
    heading: "要从对话里加到 Todo 吗？",
    yesLabel: "确认加入",
    noLabel: "这次不加",
    existingProjects: () => [],
  },
);
const emit = defineEmits<{
  confirm: [items: ProposedTodo[]];
  skip: [];
}>();

/** 可编辑副本：确认前用户能改归属/截止/耗时/优先级，确认时按改后的落库。 */
const draft = ref<ProposedTodo[]>([]);
const checked = ref<boolean[]>([]);
const expanded = ref<number | null>(null);
/** 选了「＋ 新组…」的行：归属取下方的文本输入而不是下拉。 */
const newMode = ref<Set<number>>(new Set());

watch(
  () => props.items,
  (items) => {
    draft.value = items.map((it) => ({ ...it }));
    checked.value = items.map(() => true);
    expanded.value = null;
    newMode.value = new Set();
  },
  { immediate: true },
);

interface ConfirmSection {
  when: "today" | "later";
  project: string | null;
  isNew: boolean;
  idxs: number[];
}

const sections = computed<ConfirmSection[]>(() => {
  const existing = new Set((props.existingProjects ?? []).map((t) => normKey(t)));
  const out: ConfirmSection[] = [];
  for (const when of ["today", "later"] as const) {
    const byProject = new Map<string | null, number[]>();
    draft.value.forEach((it, i) => {
      if ((it.when === "later" ? "later" : "today") !== when) return;
      const key = it.project?.trim() ? it.project.trim() : null;
      const arr = byProject.get(key) ?? [];
      arr.push(i);
      byProject.set(key, arr);
    });
    const keys = [...byProject.keys()].sort((a, b) => (a === null ? 1 : b === null ? -1 : 0));
    for (const key of keys) {
      out.push({ when, project: key, isNew: !!key && !existing.has(normKey(key)), idxs: byProject.get(key)! });
    }
  }
  return out;
});

const showWhen = computed(
  () => draft.value.some((it) => it.when === "later") && draft.value.some((it) => it.when !== "later"),
);

function metaFor(it: ProposedTodo): string {
  return todoMeta({ priority: it.priority, due: it.due, estimate: it.estimate, project: it.project }, localDate());
}

// 整组勾选：组标题的 checkbox 一键勾/取消该组全部候选。
function toggleSection(s: ConfirmSection, e: Event) {
  const on = (e.target as HTMLInputElement).checked;
  for (const i of s.idxs) checked.value[i] = on;
}

function toggleAdjust(i: number) {
  expanded.value = expanded.value === i ? null : i;
}

/** 下拉候选 = 现有项目 ∪ 当前已带的新组名（解析给出的新组也要能选中）。 */
function projOptions(i: number): string[] {
  const cur = draft.value[i]?.project?.trim();
  const opts = [...(props.existingProjects ?? [])];
  if (cur && !opts.some((p) => normKey(p) === normKey(cur))) opts.push(cur);
  return opts;
}

function projChoice(i: number): string {
  if (newMode.value.has(i)) return "__new__";
  return draft.value[i]?.project ?? "";
}

function onProjChange(i: number, e: Event) {
  const v = (e.target as HTMLSelectElement).value;
  const it = draft.value[i];
  if (!it) return;
  if (v === "__new__") {
    newMode.value.add(i);
    it.project = undefined;
    return;
  }
  newMode.value.delete(i);
  it.project = v || undefined;
}

function onNewName(i: number, e: Event) {
  const it = draft.value[i];
  if (!it) return;
  const v = (e.target as HTMLInputElement).value.trim();
  it.project = v || undefined;
}

function dateOnly(due?: string): string {
  return due && /^\d{4}-\d{2}-\d{2}/.test(due) ? due.slice(0, 10) : "";
}

function onDue(i: number, e: Event) {
  const it = draft.value[i];
  if (!it) return;
  it.due = (e.target as HTMLInputElement).value || undefined;
}

function onEstimate(i: number, e: Event) {
  const it = draft.value[i];
  if (!it) return;
  const v = Number((e.target as HTMLInputElement).value);
  it.estimate = Number.isFinite(v) && v > 0 ? Math.round(v) : undefined;
}

function onPriority(i: number, e: Event) {
  const it = draft.value[i];
  if (!it) return;
  it.priority = (e.target as HTMLInputElement).checked ? "high" : undefined;
}

function onConfirm() {
  emit(
    "confirm",
    draft.value.filter((_, i) => checked.value[i]),
  );
}
</script>
