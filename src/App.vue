<template>
  <div class="phone">
    <header class="app-top">
      <div class="brand">AI <span>日程秘书</span></div>
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
        :streaming-reply="streamingReply"
        :pending-propose="pendingPropose"
        :propose-kind="proposeKind"
        :existing-projects="projects.map((p) => p.title)"
        :recognize="onRecognize"
        :speak-reply="onSpeakReply"
        @send="onSend"
        @tidy="onTidy"
        @confirm="onConfirmPropose"
        @skip="onSkipPropose"
      />
      <TodoScreen
        v-else-if="tab === 'todo'"
        :todos="todos"
        :date="date"
        :projects="projects"
        :waitings="waitings"
        :pending-propose="pendingPropose"
        :propose-kind="proposeKind"
        :existing-projects="projects.map((p) => p.title)"
        :undo-title="undoTitle"
        :awaiting="awaiting"
        @toggle="onToggle"
        @remove="onRemove"
        @move="onMove"
        @move-group="onMoveGroup"
        @assign="onAssignGroup"
        @rename-group="onRenameGroup"
        @complete-group="onCompleteGroup"
        @create-group="onCreateGroup"
        @delete-group="onDeleteGroup"
        @add="onAddTodo"
        @update="onUpdateTodo"
        @tidy="onTidy"
        @confirm="onConfirmPropose"
        @skip="onSkipPropose"
        @resolve-waiting="onResolveWaiting"
        @undo-remove="onUndoRemove"
      />
      <DiaryScreen
        v-else-if="tab === 'diary'"
        :daily="daily"
        :past-logs="pastLogs"
        :composing="composingDiary"
        :weekly="weekly"
        :composing-weekly="composingWeekly"
        :weekly-error="weeklyError"
        @compose="onComposeDiary"
        @compose-weekly="onComposeWeekly"
        @save="onSaveLog"
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
import { composeWeeklyLog } from "@/agent/compose-week";
import { runAgent, type AgentDeps } from "@/agent/loop";
import { attributionTexts, isClarifyQuestion, replyStillAsking } from "@/agent/clarify";
import { parseInput } from "@/agent/parse";
import { routeParseResult, type RouteDeps } from "@/agent/route-parse";
import { EVENING_KICKOFF_TEXT, KICKOFF_TEXT } from "@/agent/prompt";
import { ApiError, chatCompletions, chatCompletionsStream, type ChatCompletionRequest } from "@/api/deepseek";
import { activePostJson } from "@/api/post-json";
import { recognizeSpeech } from "@/api/dashscope-asr";
import { synthesizeSpeech } from "@/api/dashscope-tts";
import { playAudio, textForSpeech } from "@/speech/tts";
import ChatScreen from "@/screens/ChatScreen.vue";
import TodoScreen from "@/screens/TodoScreen.vue";
import DiaryScreen from "@/screens/DiaryScreen.vue";
import SettingsScreen from "@/screens/SettingsScreen.vue";
import { shouldEveningGreet, shouldGreet } from "@/chat-session";
import { catchUpDiary } from "@/diary";
import { dayLabel, localDate, shiftLocalDate, weekKey } from "@/dates";
import { debugLog, logDrops } from "@/debug/log";
import { newId } from "@/ids";
import { normKey } from "@/norm";
import { withoutCoveredTitles } from "@/todos-filter";
import { rescheduleReminders } from "@/notify";
import { createNotifier, listenNotificationOpen } from "@/notify-capacitor";
import { clampSplitHour, DEFAULT_SPLIT_HOUR, ritualForNow } from "@/ritual";
import { chatRepo, eventRepo, logRepo, projectRepo, todoRepo, waitingRepo, weeklyRepo } from "@/storage/db";
import { effectiveApiKey, effectiveAsrKey, loadSettings, saveSettings } from "@/storage/settings";
import { syncProjectStatuses } from "@/todo-groups";
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
  type TodoDraft,
  type Waiting,
  type WeeklyLog,
} from "@/types";

type Tab = "chat" | "todo" | "diary" | "settings";

const tab = ref<Tab>("chat");
const settings = ref<Settings>({
  apiKey: "",
  model: DEFAULT_MODEL,
  daySplitHour: DEFAULT_SPLIT_HOUR,
});
const todos = ref<Todo[]>([]);
const projects = ref<Project[]>([]);
const waitings = ref<Waiting[]>([]);
const date = ref(localDate());
const chat = ref<DayChat>({ date: date.value, messages: [] });
const daily = ref<DailyLog | null>(null);
const pastLogs = ref<DailyLog[]>([]);
const weekly = ref<WeeklyLog | null>(null);
const composingWeekly = ref(false);
const weeklyError = ref("");
const pendingPropose = ref<ProposedTodo[] | null>(null);
const proposeKind = ref<"later" | "today">("later");
const awaiting = ref(false);
// 流式回复中的逐字文本：只进流式气泡，不落库、不进消息数组；null = 不在流式。
const streamingReply = ref<string | null>(null);
// 上一轮输入的解析结果。解析与回复并行后，回复等不起本轮解析，上下文的事件注入改用上一轮的——
// 本轮提到的事下一轮才进注入，这是并行化有意接受的取舍；首轮为 null，等同原来的「纯闲聊不注入」分支。
const lastParseResult = ref<ParseResult | null>(null);
const composingDiary = ref(false);
const catchUpNote = ref("");
const activeSession = ref<"morning" | "evening">(ritualForNow());
let proposeResolve: ((v: ProposedTodo[]) => void) | null = null;
let catchUpRunning = false;
let dayTick: number | undefined;
let closedThisTurn = false;
let lastProposeSkipped = false;
const undoTitle = ref<string | null>(null);
let lastRemoved: Todo | null = null;
let undoTimer: ReturnType<typeof setTimeout> | null = null;
let stopNotifyListen: (() => void) | undefined;

const dateLabel = computed(() => dayLabel(date.value));

async function loadDay(d: string) {
  chat.value = await chatRepo.get(d);
  daily.value = await logRepo.get(d);
  await refreshPastLogs();
  await refreshWeekly();
}

async function refreshPastLogs() {
  const all = await logRepo.list();
  pastLogs.value = all.filter((l) => l.date !== date.value);
}

async function refreshWeekly() {
  weekly.value = await weeklyRepo.get(weekKey(new Date()));
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
  await refreshReminders();
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

async function completeStream(req: ChatCompletionRequest, onText: (accumulated: string) => void) {
  const key = effectiveApiKey(settings.value);
  if (!key) {
    debugLog.push({ event: "http_fail", detail: "no key", status: 401 });
    throw new ApiError("no key", 401, "去设置里粘贴 DeepSeek API Key");
  }
  return chatCompletionsStream({ apiKey: key, request: { ...req, stream: true }, onText });
}

// 语音输入：录音已在 ChatScreen 侧完成，这里只负责拿设置里的凭证去识别。
async function onRecognize(wavBase64: string): Promise<string> {
  try {
    return await recognizeSpeech({
      apiKey: effectiveAsrKey(settings.value) ?? "",
      wavBase64,
    });
  } catch (e) {
    debugLog.push({ event: "http_fail", detail: `asr: ${e instanceof Error ? e.message : "unknown"}` });
    throw e;
  }
}

async function onSpeakReply(text: string, signal?: AbortSignal): Promise<void> {
  const said = textForSpeech(text);
  if (!said || signal?.aborted) return;
  try {
    const url = await synthesizeSpeech({
      apiKey: effectiveAsrKey(settings.value) ?? "",
      text: said,
      signal,
    });
    if (signal?.aborted) return;
    const ok = await playAudio(url, signal);
    if (signal?.aborted) return;
    if (!ok) debugLog.push({ event: "http_fail", detail: "tts: 播放失败" });
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
    debugLog.push({ event: "http_fail", detail: `tts: ${e instanceof Error ? e.message : "unknown"}` });
  }
}

async function refreshState() {
  projects.value = await projectRepo.list();
  waitings.value = await waitingRepo.listOpen();
}

// 组状态随任务自动流转：最后一条勾掉 → done；来了新活 → active。
async function syncProjects() {
  const all = await todoRepo.list();
  const nowIso = new Date().toISOString();
  const next = syncProjectStatuses(projects.value, all, nowIso);
  for (let i = 0; i < next.length; i++) {
    if (next[i] !== projects.value[i]) await projectRepo.put(next[i]);
  }
  await refreshState();
  // 任务变更汇聚点：勾选/删除/移动/落库都会走到这里，顺手重排提醒。
  await refreshReminders();
}

// 本地通知出口：原生走 Capacitor 封装，web/测试是 no-op（测试里 mock @/notify-capacitor 替换）。
const notifier = createNotifier();

// 重排提醒：策略（先全清再全量挂）在 notify.ts 的 rescheduleReminders；这里只喂当前状态。
// 失败只记 debug，绝不影响主流程。
async function refreshReminders() {
  try {
    await rescheduleReminders(notifier, { todos: todos.value, hasLogToday: !!daily.value, now: new Date() });
  } catch (e) {
    debugLog.push({ event: "notify", detail: e instanceof Error ? e.message : String(e) });
  }
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

// 组名 → 组 id：没有就建出来（否则确认框/整理给出的新组会静默落进未分组）。
async function resolveProjectId(title?: string): Promise<string | undefined> {
  const key = normKey(title ?? "");
  if (!key) return undefined;
  const hit = projects.value.find((p) => normKey(p.title) === key);
  if (hit) return hit.id;
  const created = await projectRepo.upsertByTitle((title ?? "").trim(), {});
  await refreshState();
  return created.id;
}

async function addTodos(items: ProposedTodo[]): Promise<Todo[]> {
  const sourceDate = localDate();
  const createdAt = new Date().toISOString();
  const created: Todo[] = [];
  for (const item of items) {
    const todo: Todo = {
      id: newId(),
      title: item.title,
      status: "open",
      sourceDate,
      createdAt,
      when: "later",
      priority: item.priority,
      due: item.due,
      estimate: item.estimate,
      reason: item.reason,
      projectId: await resolveProjectId(item.project),
    };
    await todoRepo.add(todo);
    created.push(todo);
  }
  todos.value = await todoRepo.list();
  await syncProjects();
  return created;
}

// 确认框互斥：解析与回复并行后两边可能同时想弹框（解析的 tasks、回复循环的工具），
// 排队一个一个弹，否则后者会顶掉 pendingPropose/proposeResolve，前一个 Promise 永远悬空。
let proposeTail: Promise<void> = Promise.resolve();

function onPropose(items: ProposedTodo[], kind: "later" | "today"): Promise<ProposedTodo[]> {
  const run = proposeTail.then(async () => {
    // 记重型过滤（只对「新记入」生效；今日计划确认框里的条目本来就在清单里，不能整表滤掉）：
    // 全字相同，或未完成标题一方包含另一方，都不再弹。滤完没有新东西就不弹框。
    let fresh = items;
    if (kind === "later") {
      fresh = withoutCoveredTitles(items, todos.value);
      logDrops("later", items.map((i) => i.title), fresh.map((i) => i.title));
      if (fresh.length === 0) return [];
    }
    return new Promise<ProposedTodo[]>((resolve) => {
      proposeKind.value = kind;
      pendingPropose.value = fresh;
      proposeResolve = resolve;
    });
  });
  proposeTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function setTodayPlan(items: ProposedTodo[]) {
  await todoRepo.applyTodayPlan(items.map((i) => i.title));
  await chatRepo.closeSession(date.value, new Date().toISOString());
  chat.value = await chatRepo.get(date.value);
  todos.value = await todoRepo.list();
  closedThisTurn = true;
  // 今日计划确认后重排提醒（整理路径 applyAcceptedPlan 由 syncProjects 覆盖）。
  await refreshReminders();
}

async function applyAcceptedPlan(items: ProposedTodo[]) {
  const toEntry = async (i: ProposedTodo) => ({ title: i.title, projectId: await resolveProjectId(i.project) });
  const today: { title: string; projectId?: string }[] = [];
  for (const i of items.filter((x) => x.when !== "later")) today.push(await toEntry(i));
  const later: { title: string; projectId?: string }[] = [];
  for (const i of items.filter((x) => x.when === "later")) later.push(await toEntry(i));
  const before = todos.value.map((t) => ({ id: t.id, title: t.title }));
  await todoRepo.applyFullPlan({ today, later });
  const after = await todoRepo.list();
  const notes: string[] = [];
  for (const t of after) {
    const prev = before.find((b) => b.id === t.id);
    if (!prev) notes.push(`新增 ${t.title}`);
    else if (prev.title !== t.title) notes.push(`${prev.title} → ${t.title}`);
  }
  debugLog.push({ event: "todo_confirmed", tool: "tidy", detail: notes.join("；") || "无标题变化" });
  await chatRepo.closeSession(date.value, new Date().toISOString());
  chat.value = await chatRepo.get(date.value);
  todos.value = await todoRepo.list();
  await syncProjects();
}

const agentDeps: AgentDeps = {
  complete,
  completeStream,
  listTodos: () => todoRepo.list(),
  setTodayPlan,
  addTodos: async (items) => {
    await addTodos(items);
  },
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

// 解析侧整条链路：解析 → 更新 lastParseResult → 分流落库 → 任务一律弹确认框。
// runTurn 把它挂起不 await（finally 才等它收尾），与回复循环并行；自带兜底 catch——
// parseInput 本身不抛异常，这里防的是分流/落库/确认出错：只记 parse_fail，绝不影响对话。
async function runParseSide(
  userText: string,
  messageId: string,
  history: ChatMessage[],
  agentDone: Promise<{ text: string; executedPropose: boolean }>,
) {
  try {
    const parseResult = await parseInput({
      text: userText,
      date: date.value,
      todos: todos.value,
      projects: projects.value,
      model: settings.value.model,
      // 最近几条对话做上下文：承接秘书的归类/拆分提问时才解析得对。
      recent: history
        .slice(-6)
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      complete,
    });
    lastParseResult.value = parseResult;
    const rawTitles = parseResult.tasks.map((t) => t.title);
    debugLog.push({
      event: "parse_ok",
      tool: "parse",
      detail: `tasks=${rawTitles.length}${rawTitles.length ? " " + rawTitles.join("、") : ""} events=${parseResult.events.length} decisions=${parseResult.decisions.length} waitings=${parseResult.waitings.length}`,
    });
    const routed = await routeParseResult(
      parseResult,
      { date: date.value, messageId, mentionTexts: attributionTexts(userText, history) },
      routeDeps,
    );
    await refreshState();
    const proposedTitles = routed.proposedTasks.map((t) => t.title);
    logDrops("parse", rawTitles, proposedTitles);
    if (routed.proposedTasks.length === 0) return;
    const { text, executedPropose } = await agentDone;
    // 本轮还在问、且回复没提议：解析框不抢话。问号和「对吧 / 说清 / 要不要记」比引导问词表宽。
    if (!executedPropose && (isClarifyQuestion(text) || replyStillAsking(text))) {
      const why = isClarifyQuestion(text) ? "引导问" : "还在问";
      debugLog.push({ event: "todo_rejected", tool: "parse", detail: `${why}，不弹：${proposedTitles.join("、")}` });
      return;
    }
    debugLog.push({ event: "propose_ui", tool: "parse", detail: proposedTitles.join("、") });
    const accepted = await onPropose(routed.proposedTasks, "later");
    if (accepted.length > 0) {
      await addTodos(accepted);
      debugLog.push({ event: "todo_confirmed", tool: "parse", detail: accepted.map((a) => a.title).join("、") });
    } else {
      debugLog.push({ event: "todo_rejected", tool: "parse", detail: "用户这次不加" });
    }
  } catch (e) {
    debugLog.push({ event: "parse_fail", detail: e instanceof Error ? e.message : String(e) });
  }
}

async function runTurn(mode: ChatMode, userText: string, opts?: { silent?: boolean }) {
  await ready;
  if (awaiting.value) return;
  awaiting.value = true;
  closedThisTurn = false;
  streamingReply.value = null;
  if (mode === "morning" || mode === "evening") activeSession.value = mode;
  const history = chat.value.messages;
  // 解析侧与回复侧并行：两边都落定本轮才算完（finally 里等 parseDone）。
  let parseDone: Promise<void> = Promise.resolve();
  const agentGate = { resolve: (_v: { text: string; executedPropose: boolean }) => {} };
  const agentDone = new Promise<{ text: string; executedPropose: boolean }>((resolve) => {
    agentGate.resolve = resolve;
  });
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
    if (userMsg) {
      // 挂起不 await：解析一启动，回复循环立刻开始。silent 轮不触发解析（维持原样）。
      // 解析框等回复结束后再决定弹不弹。
      parseDone = runParseSide(userText, userMsg.id, history, agentDone);
    }
    const yesterdayLog = await logRepo.get(shiftLocalDate(date.value, -1));
    const { assistantText, executedPropose } = await runAgent({
      deps: agentDeps,
      mode,
      userText,
      history,
      model: settings.value.model,
      planConfirmed: !!chat.value.planConfirmedAt,
      yesterdayLog,
      projects: projects.value,
      waitings: waitings.value,
      // 事件注入用上一轮的解析结果；本轮的解析完会写进 lastParseResult，下一轮生效。
      parseResult: lastParseResult.value,
      recentEvents: await eventRepo.listRecent(3),
      onReplyDelta: (text) => {
        streamingReply.value = text;
      },
    });
    agentGate.resolve({ text: assistantText, executedPropose });
    // 流式气泡使命到此：先撤掉再落最终消息，避免两个气泡同框
    streamingReply.value = null;
    if (closedThisTurn) return;
    await appendMessage({
      id: newId(),
      role: "assistant",
      content: assistantText,
      createdAt: new Date().toISOString(),
      mode,
    });
  } catch (e) {
    agentGate.resolve({ text: "", executedPropose: false });
    streamingReply.value = null;
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
    agentGate.resolve({ text: "", executedPropose: false });
    // 两边都结束本轮才算完：解析侧可能还停在确认框上等用户，等它落定再解锁输入
    await parseDone;
    awaiting.value = false;
    streamingReply.value = null;
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
      projects: projects.value,
      complete,
      model: settings.value.model,
    });
    debugLog.push({
      event: "propose_ui",
      tool: "tidy",
      detail: `今天：${plan.today.map((i) => i.title).join("、") || "无"}；以后：${plan.later.map((i) => i.title).join("、") || "无"}`,
    });
    const accepted = await onPropose([...plan.today, ...plan.later], "today");
    if (lastProposeSkipped) {
      debugLog.push({ event: "todo_rejected", tool: "tidy", detail: "用户先不定" });
      return;
    }
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
    if (wrote) {
      catchUpNote.value = "已补上上次的日记";
      await refreshPastLogs();
    }
  } finally {
    catchUpRunning = false;
  }
}

async function maybeGreet() {
  await ready;
  if (awaiting.value || pendingPropose.value) return;
  if (!effectiveApiKey(settings.value)) return;
  if (!shouldGreet(chat.value)) return;
  // 晚上（18 点起）且今天还没写日记：换成晚间开场，对照早计划逐条问进展。
  const evening = shouldEveningGreet(new Date(), chat.value, daily.value !== null);
  await runTurn(activeSession.value, evening ? EVENING_KICKOFF_TEXT : KICKOFF_TEXT, { silent: true });
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
    // 日记已写好，今晚的催写日记提醒可以撤了。
    await refreshReminders();
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

// 手改日记（LogCard 编辑保存）：落库后今天卡片与以往区一起刷。
async function onSaveLog(log: DailyLog) {
  await ready;
  await logRepo.put(log);
  if (log.date === date.value) daily.value = log;
  await refreshPastLogs();
}

async function onComposeWeekly() {
  await ready;
  if (composingWeekly.value) return;
  composingWeekly.value = true;
  weeklyError.value = "";
  try {
    const log = await composeWeeklyLog({
      now: new Date(),
      logs: await logRepo.list(),
      todos: await todoRepo.list(),
      complete,
      model: settings.value.model,
    });
    await weeklyRepo.put(log);
    weekly.value = log;
  } catch (e) {
    const userMessage = e instanceof ApiError ? e.userMessage : "周报这轮没生成";
    debugLog.push({
      event: "http_fail",
      detail: e instanceof Error ? e.message : String(e),
    });
    weeklyError.value = userMessage;
  } finally {
    composingWeekly.value = false;
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
  // 提醒是按天算的（今晚 21 点写日记、今天的 due），跨日必须重排。
  await refreshReminders();
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
  stopNotifyListen = listenNotificationOpen(() => {
    tab.value = "todo";
  });
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
  stopNotifyListen?.();
  if (dayTick !== undefined) window.clearInterval(dayTick);
  if (undoTimer !== null) clearTimeout(undoTimer);
});

function onSend(text: string) {
  void runTurn("chat", text);
}

async function onToggle(id: string) {
  await ready;
  await todoRepo.toggle(id);
  todos.value = await todoRepo.list();
  await syncProjects();
}

async function onRemove(id: string) {
  await ready;
  const hit = todos.value.find((t) => t.id === id) ?? null;
  await todoRepo.remove(id);
  todos.value = await todoRepo.list();
  await syncProjects();
  lastRemoved = hit;
  undoTitle.value = hit?.title ?? null;
  if (undoTimer !== null) clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    undoTitle.value = null;
    lastRemoved = null;
    undoTimer = null;
  }, 5000);
}

async function onUndoRemove() {
  await ready;
  if (!lastRemoved) return;
  const restore = lastRemoved;
  lastRemoved = null;
  undoTitle.value = null;
  if (undoTimer !== null) {
    clearTimeout(undoTimer);
    undoTimer = null;
  }
  await todoRepo.add(restore);
  todos.value = await todoRepo.list();
  await refreshState();
  await syncProjects();
}

async function onMove(id: string, when: "today" | "later", index: number, projectId?: string | null) {
  await ready;
  await todoRepo.move(id, when, index, { projectId });
  todos.value = await todoRepo.list();
  await syncProjects();
}

async function onMoveGroup(id: string, index: number) {
  await ready;
  await projectRepo.move(id, index);
  await refreshState();
}

async function onAssignGroup(id: string, projectId: string | null, newTitle?: string) {
  await ready;
  let pid = projectId;
  if (newTitle) {
    const p = await projectRepo.upsertByTitle(newTitle, {});
    pid = p.id;
  }
  await todoRepo.setProject(id, pid);
  todos.value = await todoRepo.list();
  // 新建组后 projects 也得刷新，否则 partitionLater 认不出新组，任务落进未分组区
  await refreshState();
  await syncProjects();
}

async function onRenameGroup(id: string, title: string) {
  await ready;
  const p = projects.value.find((x) => x.id === id);
  if (!p) return;
  await projectRepo.put({ ...p, title, updatedAt: new Date().toISOString() });
  await refreshState();
}

async function onCompleteGroup(id: string, done: boolean) {
  await ready;
  const p = projects.value.find((x) => x.id === id);
  if (!p) return;
  await projectRepo.put({ ...p, status: done ? "done" : "active", updatedAt: new Date().toISOString() });
  await refreshState();
}

async function onCreateGroup(title: string) {
  await ready;
  await projectRepo.upsertByTitle(title, {});
  await refreshState();
}

async function onDeleteGroup(id: string) {
  await ready;
  const members = todos.value.filter((t) => t.projectId === id);
  for (const t of members) await todoRepo.setProject(t.id, null);
  await projectRepo.remove(id);
  todos.value = await todoRepo.list();
  await refreshState();
  await syncProjects();
}

async function resolveDraftProject(draft: TodoDraft): Promise<string | undefined> {
  if (draft.newTitle?.trim()) {
    const created = await projectRepo.upsertByTitle(draft.newTitle.trim(), {});
    return created.id;
  }
  return draft.projectId || undefined;
}

async function onAddTodo(draft: TodoDraft) {
  await ready;
  const trimmed = draft.title.trim();
  if (!trimmed) return;
  const dup = todos.value.some((t) => t.status === "open" && normKey(t.title) === normKey(trimmed));
  if (dup) return;
  const pid = await resolveDraftProject(draft);
  await todoRepo.add({
    id: newId(),
    title: trimmed,
    status: "open",
    sourceDate: localDate(),
    createdAt: new Date().toISOString(),
    when: draft.when,
    projectId: pid,
    due: draft.due,
    estimate: draft.estimate,
    priority: draft.priority,
    reason: draft.reason,
  });
  todos.value = await todoRepo.list();
  await refreshState();
  await syncProjects();
}

async function onUpdateTodo(id: string, draft: TodoDraft) {
  await ready;
  const pid = await resolveDraftProject(draft);
  await todoRepo.update(id, {
    title: draft.title,
    when: draft.when,
    projectId: pid ?? null,
    due: draft.due ?? null,
    estimate: draft.estimate ?? null,
    priority: draft.priority ?? null,
    reason: draft.reason ?? null,
  });
  todos.value = await todoRepo.list();
  await refreshState();
  await syncProjects();
}

async function onResolveWaiting(id: string) {
  await ready;
  await waitingRepo.resolve(id);
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
