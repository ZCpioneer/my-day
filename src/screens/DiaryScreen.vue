<template>
  <section class="screen on">
    <div class="diary-scroll">
      <div class="diary-head">
        <h2>日记</h2>
        <div class="count">只记今天</div>
      </div>
      <div v-if="!daily" class="empty">
        <div class="glyph">暮</div>
        <p>点下面「整理成日记」。今天不整的话，明天打开会补上昨天。</p>
      </div>
      <div v-else class="log-card">
        <div class="log-core">
          <h3>{{ dateLabel }}</h3>
          <div class="log-block">
            <div class="lab">早计划</div>
            <p>{{ daily.plan }}</p>
          </div>
          <div class="log-block">
            <div class="lab">做成了</div>
            <ul>
              <li v-for="(t, i) in daily.done" :key="'d' + i">{{ t }}</li>
              <li v-if="daily.done.length === 0">还没有勾掉的。</li>
            </ul>
          </div>
          <div class="log-block">
            <div class="lab">没做完</div>
            <ul>
              <li v-for="(t, i) in daily.undone" :key="'u' + i">{{ t }}</li>
              <li v-if="daily.undone.length === 0">全部勾完了。</li>
            </ul>
          </div>
          <div class="log-block">
            <div class="lab">状态</div>
            <div class="mood">{{ daily.state }}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="diary-compose">
      <button
        data-diary-compose
        class="diary-compose-btn"
        type="button"
        :disabled="composing"
        @click="emit('compose')"
      >
        {{ composing ? "正在整理…" : "整理成日记" }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { DailyLog } from "@/types";

const props = defineProps<{
  daily: DailyLog | null;
  date: string;
  composing?: boolean;
}>();

const emit = defineEmits<{ compose: [] }>();

const dateLabel = computed(() => {
  const parts = props.date.split("-");
  return `${Number(parts[1])}月${Number(parts[2])}日`;
});
</script>
