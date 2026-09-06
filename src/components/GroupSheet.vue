<template>
  <div class="sheet-mask" @click.self="emit('close')">
    <div class="sheet">
      <header>{{ mode === "assign" ? "归到哪个组？" : (group?.title ?? "") }}</header>
      <template v-if="mode === 'assign'">
        <button
          v-for="p in openProjects"
          :key="p.id"
          class="sheet-opt"
          type="button"
          :data-pick="p.id"
          @click="emit('pick', p.id, undefined)"
        >
          {{ p.title }}<span v-if="p.id === current" class="sheet-cur">当前</span>
        </button>
        <button class="sheet-opt" type="button" data-pick="none" @click="emit('pick', null, undefined)">未分组</button>
        <div class="sheet-row">
          <input v-model="newTitle" type="text" placeholder="新建组…" @keydown.enter="onNew" />
          <button type="button" data-new-confirm :disabled="!newTitle.trim()" @click="onNew">建好</button>
        </div>
      </template>
      <template v-else>
        <div class="sheet-row">
          <input v-model="renameTitle" type="text" :placeholder="group?.title ?? '组名'" @keydown.enter="onRename" />
          <button type="button" data-rename :disabled="!renameTitle.trim()" @click="onRename">重命名</button>
        </div>
        <p v-if="(openCount ?? 0) > 0" class="sheet-note">还有 {{ openCount }} 件没做完</p>
        <button v-else-if="group?.status !== 'done'" class="sheet-opt" type="button" data-complete @click="emit('complete', true)">
          完成项目
        </button>
      </template>
      <button class="sheet-close" type="button" @click="emit('close')">取消</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { Project } from "@/types";

const props = defineProps<{
  mode: "assign" | "manage";
  projects: Project[];
  current?: string | null;
  group?: Project | null;
  openCount?: number;
}>();
const emit = defineEmits<{
  pick: [projectId: string | null, newTitle?: string];
  rename: [title: string];
  complete: [done: boolean];
  close: [];
}>();

const openProjects = computed(() => props.projects.filter((p) => p.status !== "done"));
const newTitle = ref("");
const renameTitle = ref("");

function onNew() {
  const t = newTitle.value.trim();
  if (!t) return;
  emit("pick", null, t);
}

function onRename() {
  const t = renameTitle.value.trim();
  if (!t) return;
  emit("rename", t);
}
</script>
