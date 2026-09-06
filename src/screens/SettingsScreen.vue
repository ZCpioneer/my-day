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
        <p class="hint">给对话一点时间感（现在像早上还是晚上）。自动整理确认后会清空这段对话。日记在日记页。默认 12。</p>
      </label>
      <div v-if="memories && memories.length > 0" class="field">
        <span>长期记忆</span>
        <p class="hint">对话里确认过的稳定偏好、长期目标、持续关注。删错了没关系，下次聊到还会再问你。</p>
        <div v-for="m in memories" :key="m.id" class="memory-row">
          <span class="todo-meta">{{ MEMORY_KIND_LABEL[m.kind] }}</span>
          <span class="memory-text">{{ m.text }}</span>
          <button type="button" :data-memory-del="m.id" @click="emit('removeMemory', m.id)">删除</button>
        </div>
      </div>
      <button class="btn-save" type="button" @click="onSave">保存</button>
      <DebugPanel />
      <p class="hint">{{ BUILD_LABEL }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { BUILD_LABEL } from "@/build-info";
import DebugPanel from "@/components/DebugPanel.vue";
import { MEMORY_KIND_LABEL, type Memory, type Settings } from "@/types";

const props = defineProps<{ settings: Settings; memories?: Memory[] }>();
const emit = defineEmits<{ save: [settings: Settings]; removeMemory: [id: string] }>();

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
