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
          <label v-for="i in s.idxs" :key="`${s.when}-${s.project ?? ''}-${i}`" class="todo-pick">
            <input v-model="checked[i]" type="checkbox" />
            <span>{{ items[i].title }}</span>
            <span v-if="metaFor(items[i])" class="todo-meta">{{ metaFor(items[i]) }}</span>
          </label>
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
    /** 已有项目标题，用来给新组打「新」标。 */
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

const items = computed(() => props.items);

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
    props.items.forEach((it, i) => {
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
  () => props.items.some((it) => it.when === "later") && props.items.some((it) => it.when !== "later"),
);

const checked = ref<boolean[]>([]);

watch(
  () => props.items,
  (items) => {
    checked.value = items.map(() => true);
  },
  { immediate: true },
);

function metaFor(it: ProposedTodo): string {
  return todoMeta({ priority: it.priority, due: it.due, project: it.project }, localDate());
}

// 整组勾选：组标题的 checkbox 一键勾/取消该组全部候选。
function toggleSection(s: ConfirmSection, e: Event) {
  const on = (e.target as HTMLInputElement).checked;
  for (const i of s.idxs) checked.value[i] = on;
}

function onConfirm() {
  emit(
    "confirm",
    props.items.filter((_, i) => checked.value[i]),
  );
}
</script>
