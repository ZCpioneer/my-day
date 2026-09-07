<template>
  <div class="log-card" :class="{ 'log-card--bare': bare }">
    <div class="log-core">
      <h3 v-if="!bare">{{ dateLabel }}</h3>
      <div class="log-block">
        <div class="lab">早计划</div>
        <p>{{ log.plan }}</p>
      </div>
      <div class="log-block">
        <div class="lab">做成了</div>
        <ul>
          <li v-for="(t, i) in log.done" :key="'d' + i">{{ t }}</li>
          <li v-if="log.done.length === 0">还没有勾掉的。</li>
        </ul>
      </div>
      <div class="log-block">
        <div class="lab">没做完</div>
        <ul>
          <li v-for="(t, i) in log.undone" :key="'u' + i">{{ t }}</li>
          <li v-if="log.undone.length === 0">全部勾完了。</li>
        </ul>
      </div>
      <div class="log-block">
        <div class="lab">状态</div>
        <div class="mood">{{ log.state }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { dayLabel } from "@/dates";
import type { DailyLog } from "@/types";

const props = withDefaults(defineProps<{ log: DailyLog; bare?: boolean }>(), { bare: false });

const dateLabel = computed(() => dayLabel(props.log.date));
</script>
