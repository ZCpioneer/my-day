<template>
  <section class="screen on">
    <div class="diary-scroll">
      <div class="diary-head">
        <h2>日记</h2>
        <div class="count">记每一天</div>
      </div>
      <div v-if="!daily" class="empty">
        <div class="glyph">晚</div>
        <p>点下面「整理成日记」。今天不整的话，明天打开会补上昨天。</p>
      </div>
      <LogCard v-else :log="daily" />
      <template v-if="pastLogs.length > 0">
        <div class="section-label">以往</div>
        <div v-for="log in pastLogs" :key="log.date" class="log-day">
          <button
            type="button"
            class="log-day-head"
            :data-log-day="log.date"
            :aria-expanded="openDates.has(log.date)"
            @click="toggleDay(log.date)"
          >
            <span>{{ dayLabel(log.date) }}</span>
            <span class="log-day-arrow">{{ openDates.has(log.date) ? "收起" : "展开" }}</span>
          </button>
          <LogCard v-if="openDates.has(log.date)" :log="log" bare />
        </div>
      </template>
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
import { ref } from "vue";
import LogCard from "@/components/LogCard.vue";
import { dayLabel } from "@/dates";
import type { DailyLog } from "@/types";

defineProps<{
  daily: DailyLog | null;
  pastLogs: DailyLog[];
  composing?: boolean;
}>();

const emit = defineEmits<{ compose: [] }>();

const openDates = ref(new Set<string>());

function toggleDay(date: string) {
  const next = new Set(openDates.value);
  if (next.has(date)) next.delete(date);
  else next.add(date);
  openDates.value = next;
}
</script>
