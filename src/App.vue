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
    <p v-if="catchUpNote" class="catchup-note">{{ catchUpNote }}</p>
    <div class="screens">
      <ChatScreen
        v-if="tab === 'chat'"
        :messages="chat.messages"
        :awaiting="awaiting"
        :pending-propose="pendingPropose"
        :propose-kind="proposeKind"
        :existing-projects="projects.map((p) => p.title)"
        @send="onSend"
        @tidy="onTidy"
        @confirm="onConfirmPropose"
        @skip="onSkipPropose"
      />
      <TodoScreen
        v-else-if="tab === 'todo'"
        :todos="todos"
        :projects="projects"
        @toggle="onToggle"
        @remove="onRemove"
        @move="onMove"
        @move-group="onMoveGroup"
      />
      <DiaryScreen
        v-else-if="tab === 'diary'"
        :daily="daily"
        :date="date"
        :composing="composingDiary"
        @compose="onComposeDiary"
      />
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
import { composeDailyLog } from "@/agent/compose-log";
import { composePlan } from "@/agent/compose-plan";
import { runAgent, type AgentDeps } from "@/agent/loop";
import { parseInput } from "@/agent/parse";
import { routeParseResult, type RouteDeps } from "@/agent/route-parse";
import { KICKOFF_TEXT } from "@/agent/prompt";
import { ApiError, chatCompletions, type ChatCompletionRequest } from "@/api/deepseek";
import { activePostJson } from "@/api/post-json";
import ChatScreen from "@/screens/ChatScreen.vue";
import TodoScreen from "@/screens/TodoScreen.vue";
import DiaryScreen from "@/screens/DiaryScreen.vue";
import SettingsScreen from "@/screens/SettingsScreen.vue";
import { shouldGreet } from "@/chat-session";
import { catchUpDiary } from "@/diary";
import { localDate, shiftLocalDate } from "@/dates";
import { debugLog } from "@/debug/log";
import { newId } from "@/ids";
import { normKey } from "@/norm";
import { clampSplitHour, DEFAULT_SPLIT_HOUR, ritualForNow } from "@/ritual";
import { chatRepo, eventRepo, logRepo, projectRepo, todoRepo, waitingRepo } from "@/storage/db";
import { effectiveApiKey, loadSettings, saveSettings } from "@/storage/settings";
import {
  DEFAULT_MODEL,
  type ChatMessage,
  type ChatMode,
  type DailyLog,
  type DayChat,
  type ParseResult,
  type Project,
  type ProposedTodo,
  type Settings,
  type Todo,
  type Waiting,
} from "@/types";

type Tab = "chat" | "todo" | "diary" | "settings";

const tab = ref<Tab>("chat");
const settings = ref<Settings>({
  apiKey: "",
  model: DEFAULT_MODEL,
  debugOverlay: false,
  daySplitHour: DEFAULT_SPLIT_HOUR,
});
const todos = ref<Todo[]>([]);
const projects = ref<Project[]>([]);
const waitings = ref<Waiting[]>([]);
const date = ref(localDate());
const chat = ref<DayChat>({ date: date.value, messages: [] });
const daily = ref<DailyLog | null>(null);
const pendingPropose = ref<ProposedTodo[] | null>(null);
const proposeKind = ref<"later" | "today">("later");
const awaiting = ref(false);
const composingDiary = ref(false);
const catchUpNote = ref("");
const activeSession = ref<"morning" | "evening">(ritualForNow());
let proposeResolve: ((v: ProposedTodo[]) => void) | null = null;
let catchUpRunning = false;
let dayTick: number | undefined;
let closedThisTurn = false;
let lastProposeSkipped = false;

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
  activeSession.value = ritualForNow(new Date(), settings.value.daySplitHour);
  todos.value = await todoRepo.list();
  await refreshState();
  await loadDay(date.value);
})();
void (async () => {
  await ready;
  await runCatchUp();
  await maybeGreet();
})();

async function complete(req: ChatCompletionRequest) {
  const key = effectiveApiKey(settings.value);
  if (!key) {
    debugLog.push({ event: "http_fail", detail: "no key", status: 401 });
    throw new ApiError("no key", 401, "去设置里粘贴 DeepSeek API Key");
  }
  return chatCompletions({ apiKey: key, request: req, postJson: activePostJson() });
}

async function refreshState() {
  projects.value = await projectRepo.list();
  waitings.value = await waitingRepo.listOpen();
}

const routeDeps: RouteDeps = {
  addEvent: (e) => eventRepo.add(e),
  upsertProject: (title, patch) => projectRepo.upsertByTitle(title, patch).then(() => undefined),
  addWaiting: (w) => waitingRepo.add(w),
  listOpenWaitings: () => waitingRepo.listOpen(),
  resolveWaiting: (id) => waitingRepo.resolve(id),
  listTodos: () => todoRepo.list(),
  now: () => new Date(),
  newId,
};

async function addTodos(items: ProposedTodo[]) {
  const sourceDate = localDate();
  const createdAt = new Date().toISOString();
  for (const item of items) {
    const project = item.project
      ? projects.value.find((p) => normKey(p.title) === normKey(item.project ?? ""))
      : undefined;
    await todoRepo.add({
      id: newId(),
      title: item.title,
      status: "open",
      sourceDate,
      createdAt,
      when: "later",
      priority: item.priority,
      due: item.due,
      projectId: project?.id,
    });
  }
  todos.value = await todoRepo.list();
}

function onPropose(items: ProposedTodo[], kind: "later" | "today"): Promise<ProposedTodo[]> {
  proposeKind.value = kind;
  pendingPropose.value = items;
  return new Promise((resolve) => {
    proposeResolve = resolve;
  });
}

async function setTodayPlan(items: ProposedTodo[]) {
  await todoRepo.applyTodayPlan(items.map((i) => i.title));
  await chatRepo.closeSession(date.value, new Date().toISOString());
  chat.value = await chatRepo.get(date.value);
  todos.value = await todoRepo.list();
  closedThisTurn = true;
}

async function applyAcceptedPlan(items: ProposedTodo[]) {
  await todoRepo.applyFullPlan({
    today: items.filter((i) => i.when !== "later").map((i) => i.title),
    later: items.filter((i) => i.when === "later").map((i) => i.title),
  });
  await chatRepo.closeSession(date.value, new Date().toISOString());
  chat.value = await chatRepo.get(date.value);
  todos.value = await todoRepo.list();
}

const agentDeps: AgentDeps = {
  complete,
  listTodos: () => todoRepo.list(),
  setTodayPlan,
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
  lastProposeSkipped = false;
  settlePropose(items);
}

function onSkipPropose() {
  lastProposeSkipped = true;
  settlePropose([]);
}

async function appendMessage(msg: ChatMessage) {
  await chatRepo.append(date.value, msg);
  chat.value = await chatRepo.get(date.value);
}

async function runTurn(mode: ChatMode, userText: string, opts?: { silent?: boolean }) {
  await ready;
  if (awaiting.value) return;
  awaiting.value = true;
  closedThisTurn = false;
  if (mode === "morning" || mode === "evening") activeSession.value = mode;
  const history = chat.value.messages;
  try {
    let userMsg: ChatMessage | null = null;
    if (!opts?.silent) {
      userMsg = {
        id: newId(),
        role: "user",
        content: userText,
        createdAt: new Date().toISOString(),
        mode,
      };
      await appendMessage(userMsg);
    }
    let parseResult: ParseResult | null = null;
    if (userMsg) {
      parseResult = await parseInput({
        text: userText,
        date: date.value,
        todos: todos.value,
        projects: projects.value,
        model: settings.value.model,
        complete,
      });
      const routed = await routeParseResult(parseResult, { date: date.value, messageId: userMsg.id }, routeDeps);
      await refreshState();
      if (routed.proposedTasks.length > 0) {
        const accepted = await onPropose(routed.proposedTasks, "later");
        if (accepted.length > 0) {
          await addTodos(accepted);
          debugLog.push({ event: "todo_confirmed", tool: "parse", detail: accepted.map((a) => a.title).join("、") });
        } else {
          debugLog.push({ event: "todo_rejected", tool: "parse", detail: "用户这次不加" });
        }
      }
    }
    const yesterdayLog = await logRepo.get(shiftLocalDate(date.value, -1));
    const { assistantText } = await runAgent({
      deps: agentDeps,
      mode,
      userText,
      history,
      model: settings.value.model,
      planConfirmed: !!chat.value.planConfirmedAt,
      yesterdayLog,
      projects: projects.value,
      waitings: waitings.value,
      parseResult,
      recentEvents: await eventRepo.listRecent(3),
    });
    if (closedThisTurn) return;
    await appendMessage({
      id: newId(),
      role: "assistant",
      content: assistantText,
      createdAt: new Date().toISOString(),
      mode,
    });
  } catch (e) {
    if (closedThisTurn) return;
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

async function onTidy() {
  await ready;
  if (awaiting.value || pendingPropose.value) return;
  awaiting.value = true;
  lastProposeSkipped = false;
  try {
    const plan = await composePlan({
      date: date.value,
      chat: chat.value,
      todos: todos.value,
      complete,
      model: settings.value.model,
    });
    const accepted = await onPropose([...plan.today, ...plan.later], "today");
    if (lastProposeSkipped) return;
    await applyAcceptedPlan(accepted);
  } catch (e) {
    const userMessage = e instanceof ApiError ? e.userMessage : "待办这轮没整理成";
    debugLog.push({
      event: "http_fail",
      detail: e instanceof Error ? e.message : String(e),
    });
    catchUpNote.value = userMessage;
  } finally {
    awaiting.value = false;
    if (proposeResolve) settlePropose([]);
  }
}

async function runCatchUp() {
  await ready;
  if (catchUpRunning) return;
  catchUpRunning = true;
  try {
    const wrote = await catchUpDiary({
      today: localDate(),
      hasKey: !!effectiveApiKey(settings.value),
      getChat: (d) => chatRepo.get(d),
      listTodos: () => todoRepo.list(),
      getLog: (d) => logRepo.get(d),
      putLog: (log) => logRepo.put(log),
      compose: async (d) =>
        composeDailyLog({
          date: d,
          now: new Date(),
          chat: await chatRepo.get(d),
          todos: await todoRepo.list(),
          complete,
          model: settings.value.model,
        }),
    });
    if (wrote) catchUpNote.value = "已补上上次的日记";
  } finally {
    catchUpRunning = false;
  }
}

async function maybeGreet() {
  await ready;
  if (awaiting.value || pendingPropose.value) return;
  if (!effectiveApiKey(settings.value)) return;
  if (!shouldGreet(chat.value)) return;
  await runTurn(activeSession.value, KICKOFF_TEXT, { silent: true });
}

async function onComposeDiary() {
  await ready;
  if (composingDiary.value) return;
  composingDiary.value = true;
  try {
    const d = date.value;
    const log = await composeDailyLog({
      date: d,
      now: new Date(),
      chat: await chatRepo.get(d),
      todos: await todoRepo.list(),
      complete,
      model: settings.value.model,
    });
    await logRepo.put(log);
    if (log.date === date.value) daily.value = log;
  } catch (e) {
    const userMessage = e instanceof ApiError ? e.userMessage : "日记这轮没写成";
    debugLog.push({
      event: "http_fail",
      detail: e instanceof Error ? e.message : String(e),
    });
    catchUpNote.value = userMessage;
  } finally {
    composingDiary.value = false;
  }
}

async function rollToTodayIfNeeded() {
  const next = localDate();
  const session = ritualForNow(new Date(), settings.value.daySplitHour);
  if (next === date.value) {
    if (!awaiting.value) activeSession.value = session;
    return false;
  }
  date.value = next;
  activeSession.value = session;
  await ready;
  await loadDay(next);
  return true;
}

function onVisibilityChange() {
  if (document.visibilityState !== "visible") return;
  void (async () => {
    await rollToTodayIfNeeded();
    await runCatchUp();
    await maybeGreet();
  })();
}

onMounted(() => {
  document.addEventListener("visibilitychange", onVisibilityChange);
  dayTick = window.setInterval(() => {
    void (async () => {
      const rolled = await rollToTodayIfNeeded();
      if (rolled) {
        await runCatchUp();
        await maybeGreet();
      }
    })();
  }, 60_000);
});
onUnmounted(() => {
  document.removeEventListener("visibilitychange", onVisibilityChange);
  if (dayTick !== undefined) window.clearInterval(dayTick);
});

function onSend(text: string) {
  void runTurn("chat", text);
}

async function onToggle(id: string) {
  await ready;
  await todoRepo.toggle(id);
  todos.value = await todoRepo.list();
}

async function onRemove(id: string) {
  await ready;
  await todoRepo.remove(id);
  todos.value = await todoRepo.list();
}

async function onMove(id: string, when: "today" | "later", index: number, projectId?: string | null) {
  await ready;
  await todoRepo.move(id, when, index, { projectId });
  todos.value = await todoRepo.list();
}

async function onMoveGroup(id: string, index: number) {
  await ready;
  await projectRepo.move(id, index);
  await refreshState();
}

async function onSaveSettings(next: Settings) {
  await ready;
  const saved = { ...next, daySplitHour: clampSplitHour(next.daySplitHour) };
  await saveSettings(saved);
  settings.value = saved;
  if (!awaiting.value) activeSession.value = ritualForNow(new Date(), saved.daySplitHour);
}
</script>
