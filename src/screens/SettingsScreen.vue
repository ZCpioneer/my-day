<template>
  <section class="screen on">
    <div class="settings-scroll">
      <div class="todo-head">
        <h2>设置</h2>
      </div>
      <label class="field">
        <span>DeepSeek API Key</span>
        <input v-model="draft.apiKey" type="password" autocomplete="off" />
      </label>
      <label class="field">
        <span>模型</span>
        <select v-model="draft.model">
          <option value="deepseek-v4-flash">deepseek-v4-flash</option>
          <option value="deepseek-v4-pro">deepseek-v4-pro</option>
        </select>
      </label>
      <label class="field-row">
        <span>调试面板</span>
        <input v-model="draft.debugOverlay" type="checkbox" />
      </label>
      <button class="btn-save" type="button" @click="onSave">保存</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import type { Settings } from "@/types";

const props = defineProps<{ settings: Settings }>();
const emit = defineEmits<{ save: [settings: Settings] }>();

const draft = ref<Settings>({ ...props.settings });

watch(
  () => props.settings,
  (s) => {
    draft.value = { ...s };
  },
  { deep: true },
);

function onSave() {
  emit("save", { ...draft.value });
}
</script>
