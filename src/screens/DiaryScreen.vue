<template>
  <section class="screen on">
    <div class="diary-scroll">
      <div class="diary-head">
        <h2>日记</h2>
        <div class="count">只记今天</div>
      </div>
      <div v-if="!daily" class="empty">
        <div class="glyph">暮</div>
        <p>晚上点「暮」聊完之后，今天的记录会出现在这里。</p>
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
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { DailyLog } from "@/types";

const props = defineProps<{ daily: DailyLog | null; date: string }>();

const dateLabel = computed(() => {
  const parts = props.date.split("-");
  return `${Number(parts[1])}月${Number(parts[2])}日`;
});
</script>
