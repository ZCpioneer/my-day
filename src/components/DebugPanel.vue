<template>
  <aside class="debug-panel">
    <header class="debug-head">
      <button type="button" @click="expanded = !expanded">Debug</button>
      <button type="button" @click="debugLog.clear()">清空</button>
      <button type="button" @click="copy">复制</button>
    </header>
    <ul v-if="expanded" class="debug-list">
      <li v-for="e in debugLog.entries" :key="e.id">
        {{ e.time }} {{ e.event }}
        <template v-if="e.status != null"> status={{ e.status }}</template>
        <template v-if="e.durationMs != null"> {{ e.durationMs }}ms</template>
        <template v-if="e.model"> {{ e.model }}</template>
        <template v-if="e.tool"> {{ e.tool }}</template>
        {{ e.detail }}
      </li>
    </ul>
  </aside>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { debugLog } from "@/debug/log";

const expanded = ref(true);

async function copy() {
  const text = debugLog.toText();
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
}
</script>
