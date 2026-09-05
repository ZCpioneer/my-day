<template>
  <section class="screen on">
    <div class="settings-scroll">
      <div class="todo-head">
        <h2>设置</h2>
      </div>
      <label class="field">
        <span>DeepSeek API Key</span>
        <input v-model="draft.apiKey" type="password" autocomplete="off" placeholder="留空则用内置调试 Key" />
        <p class="hint">可以自己贴 Key。不填就用内置的调试 Key。</p>
      </label>
      <label class="field">
        <span>模型</span>
        <select v-model="draft.model">
          <option value="deepseek-v4-flash">deepseek-v4-flash</option>
          <option value="deepseek-v4-pro">deepseek-v4-pro</option>
        </select>
      </label>
      <label class="field">
        <span>朝暮分界（小时）</span>
        <input v-model.number="draft.daySplitHour" type="number" min="0" max="23" step="1" />
        <p class="hint">这个点之前算朝（开始），到了这个点及以后算暮（结束）。默认 12，即上午开始、下午结束。</p>
      </label>
      <button class="btn-save" type="button" @click="onSave">保存</button>
      <DebugPanel />
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import DebugPanel from "@/components/DebugPanel.vue";
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
  const hour = Number(draft.value.daySplitHour);
  emit("save", { ...draft.value, daySplitHour: Number.isFinite(hour) ? hour : 12 });
}
</script>
