<template>
  <div class="phone">
    <header class="app-top">
      <div class="brand">朝<span>暮</span></div>
      <div class="when">
        <em>{{ dateLabel }}</em>
        <button type="button" class="gear" data-nav="settings" @click="tab = 'settings'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
            <circle cx="12" cy="12" r="3.2" />
            <path
              d="M12 3.2v2M12 18.8v2M3.2 12h2M18.8 12h2M6.1 6.1l1.4 1.4M16.5 16.5l1.4 1.4M17.9 6.1l-1.4 1.4M7.5 16.5l-1.4 1.4"
            />
          </svg>
          设置
        </button>
      </div>
    </header>
    <div class="screens">
      <RitualBar
        v-if="tab === 'chat'"
        :disabled="awaiting"
        :morning-active="lastRitual === 'morning'"
        :evening-active="lastRitual === 'evening'"
        @morning="onMorning"
        @evening="onEvening"
      />
      <ChatScreen
        v-if="tab === 'chat'"
        :messages="chat.messages"
        :awaiting="awaiting"
        :pending-propose="pendingPropose"
        @send="onSend"
        @confirm="onConfirmPropose"
        @skip="onSkipPropose"
      />
      <TodoScreen v-else-if="tab === 'todo'" :todos="todos" @toggle="onToggle" />
      <DiaryScreen v-else-if="tab === 'diary'" :daily="daily" :date="date" />
      <SettingsScreen v-else :settings="settings" @save="onSaveSettings" />
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { runAgent, type AgentDeps } from "@/agent/loop";
import { ApiError, chatCompletions, type ChatCompletionRequest } from "@/api/deepseek";
import { activePostJson } from "@/api/post-json";
import RitualBar from "@/components/RitualBar.vue";
import ChatScreen from "@/screens/ChatScreen.vue";
import TodoScreen from "@/screens/TodoScreen.vue";
import DiaryScreen from "@/screens/DiaryScreen.vue";
import SettingsScreen from "@/screens/SettingsScreen.vue";
import { localDate } from "@/dates";
import { debugLog } from "@/debug/log";
import { newId } from "@/ids";
import { chatRepo, logRepo, todoRepo } from "@/storage/db";
import { effectiveApiKey, loadSettings, saveSettings } from "@/storage/settings";
import {
  DEFAULT_MODEL,
  type ChatMessage,
  type ChatMode,
  type DailyLog,
  type DayChat,
  type ProposedTodo,
  type Settings,
  type Todo,
} from "@/types";

type Tab = "chat" | "todo" | "diary" | "settings";

const tab = ref<Tab>("chat");
const settings = ref<Settings>({
  apiKey: "",
  model: DEFAULT_MODEL,
  debugOverlay: false,
});
const todos = ref<Todo[]>([]);
const date = ref(localDate());
const chat = ref<DayChat>({ date: date.value, messages: [] });
const daily = ref<DailyLog | null>(null);
const pendingPropose = ref<ProposedTodo[] | null>(null);
const awaiting = ref(false);
const lastRitual = ref<ChatMode | null>(null);
let proposeResolve: ((v: ProposedTodo[]) => void) | null = null;

const dateLabel = computed(() => formatDateLabel(date.value));

function formatDateLabel(iso: string): string {
  const parts = iso.split("-");
  return `${Number(parts[1])}月${Number(parts[2])}日`;
}

async function loadDay(d: string) {
  chat.value = await chatRepo.get(d);
  daily.value = await logRepo.get(d);
}

const ready = (async () => {
  settings.value = await loadSettings();
  todos.value = await todoRepo.list();
  await loadDay(date.value);
})();

function onVisibilityChange() {
  if (document.visibilityState !== "visible") return;
  const next = localDate();
  if (next === date.value) return;
  date.value = next;
  void (async () => {
    await ready;
    await loadDay(next);
  })();
}

onMounted(() => document.addEventListener("visibilitychange", onVisibilityChange));
onUnmounted(() => document.removeEventListener("visibilitychange", onVisibilityChange));

async function complete(req: ChatCompletionRequest) {
  const key = effectiveApiKey(settings.value);
  if (!key) {
    debugLog.push({ event: "http_fail", detail: "no key", status: 401 });
    throw new ApiError("no key", 401, "去设置里粘贴 DeepSeek API Key");
  }
  return chatCompletions({ apiKey: key, request: req, postJson: activePostJson() });
}

async function addTodos(items: ProposedTodo[]) {
  const sourceDate = localDate();
  const createdAt = new Date().toISOString();
  for (const item of items) {
    await todoRepo.add({
      id: newId(),
      title: item.title,
      status: "open",
      sourceDate,
      createdAt,
    });
  }
  todos.value = await todoRepo.list();
}

async function writeDailyLog(log: DailyLog) {
  await logRepo.put(log);
  if (log.date === date.value) daily.value = log;
}

function onPropose(items: ProposedTodo[]): Promise<ProposedTodo[]> {
  pendingPropose.value = items;
  return new Promise((resolve) => {
    proposeResolve = resolve;
  });
}

const agentDeps: AgentDeps = {
  complete,
  listTodos: () => todoRepo.list(),
  addTodos,
  writeDailyLog,
  now: () => new Date(),
  onPropose,
};

function settlePropose(accepted: ProposedTodo[]) {
  pendingPropose.value = null;
  const resolve = proposeResolve;
  proposeResolve = null;
  resolve?.(accepted);
}

function onConfirmPropose(items: ProposedTodo[]) {
  settlePropose(items);
}

function onSkipPropose() {
  settlePropose([]);
}

async function appendMessage(msg: ChatMessage) {
  await chatRepo.append(date.value, msg);
  chat.value = await chatRepo.get(date.value);
}

async function runTurn(mode: ChatMode, userText: string) {
  await ready;
  if (awaiting.value) return;
  awaiting.value = true;
  if (mode === "morning" || mode === "evening") lastRitual.value = mode;
  const history = chat.value.messages.slice();
  try {
    await appendMessage({
      id: newId(),
      role: "user",
      content: userText,
      createdAt: new Date().toISOString(),
      mode,
    });
    const { assistantText } = await runAgent({
      deps: agentDeps,
      mode,
      userText,
      history,
      model: settings.value.model,
    });
    await appendMessage({
      id: newId(),
      role: "assistant",
      content: assistantText,
      createdAt: new Date().toISOString(),
      mode,
    });
  } catch (e) {
    const userMessage = e instanceof ApiError ? e.userMessage : "模型这轮没回上，再说一次";
    if (!(e instanceof ApiError)) {
      debugLog.push({ event: "http_fail", detail: e instanceof Error ? e.message : String(e) });
    }
    await appendMessage({
      id: newId(),
      role: "assistant",
      content: userMessage,
      createdAt: new Date().toISOString(),
      mode,
    });
  } finally {
    awaiting.value = false;
    if (proposeResolve) settlePropose([]);
  }
}

function onMorning() {
  void runTurn("morning", "开始今天。");
}

function onEvening() {
  void runTurn("evening", "今天结束了。");
}

function onSend(text: string) {
  void runTurn("chat", text);
}

async function onToggle(id: string) {
  await ready;
  await todoRepo.toggle(id);
  todos.value = await todoRepo.list();
}

async function onSaveSettings(next: Settings) {
  await ready;
  await saveSettings(next);
  settings.value = next;
}
</script>
