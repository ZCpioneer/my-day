<template>
  <section class="screen on">
    <div class="diary-scroll">
      <div class="diary-head">
        <h2>日记</h2>
        <div class="count">{{ weekdayLabel(localDate()) }}</div>
      </div>
      <div v-if="!daily" class="diary-empty">
        <p>点下面「整理成日记」。今天不整的话，明天打开会补上昨天。</p>
      </div>
      <LogCard v-else :log="daily" kicker="今天" @save="emit('save', $event)" />
      <div v-if="weekly" class="log-card">
        <div class="log-core">
          <button
            type="button"
            class="weekly-mast"
            data-weekly-toggle
            :aria-expanded="weeklyOpen"
            @click="weeklyOpen = !weeklyOpen"
          >
            <span>本周 · {{ weekRange }}</span>
            <span class="weekly-caret" aria-hidden="true">{{ weeklyOpen ? "▴" : "▾" }}</span>
          </button>
          <template v-if="weeklyOpen">
            <div class="log-block">
              <div class="lab">完成了</div>
              <p>{{ weekly.done }}</p>
            </div>
            <div class="log-block">
              <div class="lab">没做完</div>
              <p>{{ weekly.undone }}</p>
            </div>
            <div class="log-block">
              <div class="lab">下周建议</div>
              <div class="mood">{{ weekly.next }}</div>
            </div>
            <div class="log-actions">
              <button
                type="button"
                class="log-edit-btn"
                data-weekly-compose
                :disabled="composingWeekly"
                @click="emit('composeWeekly')"
              >
                {{ composingWeekly ? "正在生成…" : "重新生成" }}
              </button>
            </div>
          </template>
        </div>
      </div>
      <div v-else class="weekly-empty">
        <button
          data-weekly-compose
          class="weekly-btn"
          type="button"
          :disabled="composingWeekly"
          @click="emit('composeWeekly')"
        >
          {{ composingWeekly ? "正在生成…" : "生成本周周报" }}
        </button>
      </div>
      <p v-if="weeklyError" class="weekly-error" data-weekly-error>{{ weeklyError }}</p>
      <template v-for="group in pastGroups" :key="group.key">
        <div class="section-label">{{ group.label }}</div>
        <LogCard
          v-for="log in group.logs"
          :key="log.date"
          :log="log"
          collapsible
          :collapsed="!openDates.has(log.date)"
          @toggle="toggleDay(log.date)"
          @save="emit('save', $event)"
        />
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
        {{ composeLabel }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import LogCard from "@/components/LogCard.vue";
import { dayLabel, localDate, monthLabel, weekdayLabel } from "@/dates";
import type { DailyLog, WeeklyLog } from "@/types";

const props = defineProps<{
  daily: DailyLog | null;
  pastLogs: DailyLog[];
  composing?: boolean;
  weekly?: WeeklyLog | null;
  composingWeekly?: boolean;
  weeklyError?: string;
}>();

const emit = defineEmits<{ compose: []; composeWeekly: []; save: [log: DailyLog] }>();

const weekRange = computed(() =>
  props.weekly ? `${dayLabel(props.weekly.from)}–${dayLabel(props.weekly.to)}` : "",
);

const composeLabel = computed(() => {
  if (props.composing) return "正在整理…";
  return props.daily ? "重新整理" : "整理成日记";
});

const pastGroups = computed(() => {
  const today = localDate();
  const groups: { key: string; label: string; logs: DailyLog[] }[] = [];
  for (const log of props.pastLogs) {
    const key = log.date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.logs.push(log);
    else groups.push({ key, label: monthLabel(log.date, today), logs: [log] });
  }
  return groups;
});

const openDates = ref(new Set<string>());
const weeklyOpen = ref(false);

watch(
  () => props.weekly,
  (next, prev) => {
    // 刚生成或重新生成：把结果展开给人看。进页时已有周报仍默认收起。
    if (next && prev !== undefined) weeklyOpen.value = true;
  },
);

function toggleDay(date: string) {
  const next = new Set(openDates.value);
  if (next.has(date)) next.delete(date);
  else next.add(date);
  openDates.value = next;
}
</script>
