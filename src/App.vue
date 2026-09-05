<template>
  <div class="phone">
    <header class="app-top">
      <div class="brand">朝<span>暮</span></div>
      <div class="when">
        <em>{{ dateLabel }}</em>
        <button type="button" class="gear" data-nav="settings" aria-label="设置" @click="tab = 'settings'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
            <circle cx="12" cy="12" r="3.2" />
            <path
              d="M12 3.2v2M12 18.8v2M3.2 12h2M18.8 12h2M6.1 6.1l1.4 1.4M16.5 16.5l1.4 1.4M17.9 6.1l-1.4 1.4M7.5 16.5l-1.4 1.4"
            />
          </svg>
        </button>
      </div>
    </header>
    <div class="screens">
      <RitualBar v-if="tab === 'chat'" @morning="onMorning" @evening="onEvening" />
      <ChatScreen v-if="tab === 'chat'" />
      <TodoScreen v-else-if="tab === 'todo'" />
      <DiaryScreen v-else-if="tab === 'diary'" />
      <SettingsScreen v-else />
    </div>
    <div class="dock-wrap">
      <nav class="dock">
        <button data-nav="chat" type="button" :class="{ on: tab === 'chat' }" @click="tab = 'chat'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
            <path d="M5 7.5h14M5 12h9M5 16.5h11" />
          </svg>
          对话
        </button>
        <button data-nav="todo" type="button" :class="{ on: tab === 'todo' }" @click="tab = 'todo'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
            <rect x="5" y="5" width="14" height="14" rx="3" />
            <path d="M8 12l2.5 2.5L16 9" />
          </svg>
          待办
        </button>
        <button data-nav="diary" type="button" :class="{ on: tab === 'diary' }" @click="tab = 'diary'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
            <path d="M7 4.5h10v15H7z" />
            <path d="M9.5 8h5M9.5 12h5M9.5 16h3" />
          </svg>
          日记
        </button>
      </nav>
    </div>
    <DebugPanel v-if="settings.debugOverlay" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import RitualBar from "./components/RitualBar.vue";
import DebugPanel from "./components/DebugPanel.vue";
import ChatScreen from "./screens/ChatScreen.vue";
import TodoScreen from "./screens/TodoScreen.vue";
import DiaryScreen from "./screens/DiaryScreen.vue";
import SettingsScreen from "./screens/SettingsScreen.vue";
import { localDate } from "./dates";
import { loadSettings } from "./storage/settings";
import { DEFAULT_MODEL, type Settings } from "./types";

type Tab = "chat" | "todo" | "diary" | "settings";

const tab = ref<Tab>("chat");
const settings = reactive<Settings>({
  apiKey: "",
  model: DEFAULT_MODEL,
  debugOverlay: true,
});

const dateLabel = formatDateLabel(localDate());

function formatDateLabel(iso: string): string {
  const parts = iso.split("-");
  return `${Number(parts[1])}月${Number(parts[2])}日`;
}

onMounted(async () => {
  const loaded = await loadSettings();
  settings.apiKey = loaded.apiKey;
  settings.model = loaded.model;
  settings.debugOverlay = loaded.debugOverlay;
});

function onMorning() {}
function onEvening() {}
</script>
