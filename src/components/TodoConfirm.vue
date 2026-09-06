<template>
  <div class="msg agent propose">
    <div class="who">待确认</div>
    <div class="propose-shell">
      <div class="propose-core">
        <header>{{ heading }}</header>
        <p v-if="note" class="propose-note">{{ note }}</p>
        <template v-if="showGroups">
          <p v-if="todayIdxs.length" class="propose-group">今天</p>
          <label v-for="i in todayIdxs" :key="`t-${i}`" class="todo-pick">
            <input v-model="checked[i]" type="checkbox" />
            {{ items[i].title }}
          </label>
          <p v-if="laterIdxs.length" class="propose-group">以后</p>
          <label v-for="i in laterIdxs" :key="`l-${i}`" class="todo-pick">
            <input v-model="checked[i]" type="checkbox" />
            {{ items[i].title }}
          </label>
        </template>
        <template v-else>
          <label v-for="(it, i) in items" :key="i" class="todo-pick">
            <input v-model="checked[i]" type="checkbox" />
            {{ it.title }}
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
import type { ProposedTodo } from "@/types";

const props = withDefaults(
  defineProps<{
    items?: ProposedTodo[];
    heading?: string;
    yesLabel?: string;
    noLabel?: string;
    note?: string;
  }>(),
  {
    items: () => [],
    heading: "要从对话里加到 Todo 吗？",
    yesLabel: "确认加入",
    noLabel: "这次不加",
  },
);
const emit = defineEmits<{
  confirm: [items: ProposedTodo[]];
  skip: [];
}>();

const items = computed(() => props.items);
const todayIdxs = computed(() =>
  props.items.map((it, i) => (it.when !== "later" ? i : -1)).filter((i) => i >= 0),
);
const laterIdxs = computed(() =>
  props.items.map((it, i) => (it.when === "later" ? i : -1)).filter((i) => i >= 0),
);
const showGroups = computed(() => laterIdxs.value.length > 0);
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
