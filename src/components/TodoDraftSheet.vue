<template>
  <div class="sheet-mask" data-add-sheet @click.self="emit('close')">
    <div class="sheet">
      <header>{{ mode === "edit" ? "改待办" : "新增待办" }}</header>
      <div class="sheet-row">
        <input
          ref="titleEl"
          v-model="title"
          data-add-title
          type="text"
          placeholder="要做的事"
          @keydown.enter="submit"
        />
      </div>
      <div class="sheet-seg">
        <button
          type="button"
          data-add-when="today"
          :class="{ on: when === 'today' }"
          @click="when = 'today'"
        >今天</button>
        <button
          type="button"
          data-add-when="later"
          :class="{ on: when === 'later' }"
          @click="when = 'later'"
        >以后</button>
      </div>
      <div class="sheet-row">
        <select data-add-group :value="groupChoice" @change="onGroupChange">
          <option value="">不分组</option>
          <option v-for="p in openProjects" :key="p.id" :value="p.id">{{ p.title }}</option>
          <option value="__new__">＋ 新组…</option>
        </select>
      </div>
      <div v-if="groupChoice === '__new__'" class="sheet-row">
        <input
          v-model="newGroup"
          data-add-group-new
          type="text"
          placeholder="组名，如：搬家"
          @keydown.enter="submit"
        />
      </div>
      <div class="sheet-row sheet-meta">
        <label class="sheet-field">
          截止
          <input data-add-due type="date" :value="dueDate" @input="dueDate = ($event.target as HTMLInputElement).value" />
        </label>
        <label class="sheet-field">
          时刻
          <input data-add-time type="time" :value="dueTime" @input="dueTime = ($event.target as HTMLInputElement).value" />
        </label>
      </div>
      <div class="sheet-row sheet-meta">
        <label class="sheet-field">
          约
          <input
            data-add-estimate
            type="number"
            min="0"
            step="5"
            placeholder="分钟"
            :value="estimate"
            @input="onEstimate"
          />
        </label>
        <label class="sheet-field sheet-hot">
          <input data-add-priority type="checkbox" :checked="priority === 'high'" @change="onPriority" />
          急
        </label>
      </div>
      <div class="sheet-row">
        <input
          v-model="reason"
          data-add-reason
          type="text"
          placeholder="为什么做（可空）"
        />
      </div>
      <button class="sheet-submit" type="button" data-add-confirm :disabled="!title.trim()" @click="submit">
        {{ mode === "edit" ? "保存" : "加上" }}
      </button>
      <button class="sheet-close" type="button" data-add-cancel @click="emit('close')">取消</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { composeDue, splitDue } from "@/todo-meta";
import type { Project, TodoDraft } from "@/types";

const props = defineProps<{
  mode: "add" | "edit";
  projects: Project[];
  initial?: TodoDraft;
}>();
const emit = defineEmits<{
  submit: [draft: TodoDraft];
  close: [];
}>();

const titleEl = ref<HTMLInputElement | null>(null);
const title = ref(props.initial?.title ?? "");
const when = ref<"today" | "later">(props.initial?.when ?? "today");
const groupChoice = ref(props.initial?.projectId ?? "");
const newGroup = ref(props.initial?.newTitle ?? "");
const split = splitDue(props.initial?.due);
const dueDate = ref(split.date);
const dueTime = ref(split.time);
const estimate = ref(props.initial?.estimate ? String(props.initial.estimate) : "");
const priority = ref<"high" | "normal" | undefined>(props.initial?.priority);
const reason = ref(props.initial?.reason ?? "");

const openProjects = computed(() => props.projects.filter((p) => p.status !== "done"));

onMounted(() => {
  void nextTick(() => titleEl.value?.focus());
});

function onGroupChange(e: Event) {
  groupChoice.value = (e.target as HTMLSelectElement).value;
  if (groupChoice.value !== "__new__") newGroup.value = "";
}

function onEstimate(e: Event) {
  estimate.value = (e.target as HTMLInputElement).value;
}

function onPriority(e: Event) {
  priority.value = (e.target as HTMLInputElement).checked ? "high" : undefined;
}

function submit() {
  const t = title.value.trim();
  if (!t) return;
  const draft: TodoDraft = { title: t, when: when.value };
  if (groupChoice.value === "__new__") {
    const name = newGroup.value.trim();
    if (name) {
      draft.projectId = null;
      draft.newTitle = name;
    }
  } else if (groupChoice.value) {
    draft.projectId = groupChoice.value;
  } else {
    draft.projectId = null;
  }
  const due = composeDue(dueDate.value, dueTime.value);
  if (due) draft.due = due;
  const minutes = Number(estimate.value);
  if (Number.isFinite(minutes) && minutes > 0) draft.estimate = Math.round(minutes);
  if (priority.value === "high") draft.priority = "high";
  const why = reason.value.trim();
  if (why) draft.reason = why;
  emit("submit", draft);
}
</script>
