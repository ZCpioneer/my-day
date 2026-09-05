<template>
  <div class="msg agent propose">
    <div class="who">待确认</div>
    <div class="propose-shell">
      <div class="propose-core">
        <header>要从对话里加到 Todo 吗？</header>
        <label v-for="(it, i) in items" :key="i" class="todo-pick">
          <input v-model="checked[i]" type="checkbox" />
          {{ it.title }}
        </label>
        <div class="propose-actions">
          <button class="btn-yes" type="button" @click="onConfirm">确认加入</button>
          <button class="btn-no" type="button" @click="emit('skip')">这次不加</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import type { ProposedTodo } from "@/types";

const props = defineProps<{ items: ProposedTodo[] }>();
const emit = defineEmits<{
  confirm: [items: ProposedTodo[]];
  skip: [];
}>();

const checked = ref<boolean[]>([]);

watch(
  () => props.items,
  (items) => {
    checked.value = items.map(() => true);
  },
  { immediate: true },
);

function onConfirm() {
  emit(
    "confirm",
    props.items.filter((_, i) => checked.value[i]),
  );
}
</script>
