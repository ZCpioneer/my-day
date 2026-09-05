<template>
  <section class="screen on">
    <div class="todo-scroll">
      <div class="todo-head">
        <h2>今日</h2>
        <div class="count">{{ done.length }} / {{ todos.length }}</div>
      </div>
      <div class="section-label">未完成</div>
      <div
        v-for="t in open"
        :key="t.id"
        class="item"
        :data-todo="t.id"
        @click="emit('toggle', t.id)"
      >
        <div class="box"></div>
        <div>
          <p>{{ t.title }}</p>
          <div v-if="t.sourceDate !== today" class="meta">跨天</div>
        </div>
      </div>
      <p v-if="open.length === 0" class="empty" style="margin: 8px 0">没有未做的事了。</p>
      <div class="section-label">已完成</div>
      <div
        v-for="t in done"
        :key="t.id"
        class="item done"
        :data-todo="t.id"
        @click="emit('toggle', t.id)"
      >
        <div class="box">✓</div>
        <div>
          <p>{{ t.title }}</p>
        </div>
      </div>
      <p v-if="done.length === 0" class="empty" style="margin: 8px 0">还没勾过。</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { localDate } from "@/dates";
import type { Todo } from "@/types";

const props = defineProps<{ todos: Todo[] }>();
const emit = defineEmits<{ toggle: [id: string] }>();

const today = localDate();
const open = computed(() => props.todos.filter((t) => t.status === "open"));
const done = computed(() => props.todos.filter((t) => t.status === "done"));
</script>
