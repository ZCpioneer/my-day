<template>
  <section class="screen on">
    <div class="ritual chat-mode" role="tablist" aria-label="对话方式">
      <button
        type="button"
        role="tab"
        data-testid="mode-text"
        :class="{ active: mode === 'text' }"
        :aria-selected="mode === 'text'"
        @click="setMode('text')"
      >
        <strong>文字对话</strong>
      </button>
      <button
        type="button"
        role="tab"
        data-testid="mode-voice"
        :class="{ active: mode === 'voice' }"
        :aria-selected="mode === 'voice'"
        @click="setMode('voice')"
      >
        <strong>语音模式</strong>
      </button>
    </div>
    <div ref="threadEl" class="thread">
      <div v-if="messages.length === 0 && !pendingPropose && !awaiting" class="empty">
        <div class="glyph">秘书</div>
        <p>
          想到什么直接说。<br />聊完点「自动整理待办」。确认这次整理后这段会清掉，可以重新聊。
        </p>
      </div>
      <div
        v-for="m in messages"
        :key="m.id"
        class="msg"
        :class="m.role === 'user' ? 'me' : 'agent'"
      >
        <div class="who">{{ m.role === "user" ? "我" : "秘书" }}</div>
        <div class="bubble">
          <p
            v-for="(line, i) in parseRichText(m.content)"
            :key="i"
            :class="{ blank: line.length === 0 }"
          >
            <template v-for="(seg, j) in line" :key="j">
              <strong v-if="seg.bold">{{ seg.text }}</strong>
              <template v-else>{{ seg.text }}</template>
            </template>
          </p>
        </div>
      </div>
      <div v-if="streamingReply" class="msg agent streaming" data-testid="streaming">
        <div class="who">秘书</div>
        <div class="bubble">
          <p
            v-for="(line, i) in streamingLines"
            :key="i"
            :class="{ blank: line.length === 0 }"
          >
            <template v-for="(seg, j) in line" :key="j">
              <strong v-if="seg.bold">{{ seg.text }}</strong>
              <template v-else>{{ seg.text }}</template>
            </template>
            <span v-if="i === streamingLines.length - 1" class="stream-cursor" aria-hidden="true" />
          </p>
        </div>
      </div>
      <TodoConfirm
        v-if="pendingPropose && proposeKind === 'today'"
        :items="pendingPropose"
        heading="这样排可以吗？"
        yes-label="确认这次整理"
        no-label="先不定"
        note="确认后这段对话会清空，可以重新聊。"
        :existing-projects="existingProjects"
        @confirm="emit('confirm', $event)"
        @skip="emit('skip')"
      />
      <TodoConfirm
        v-else-if="pendingPropose"
        :items="pendingPropose"
        heading="记到「以后」吗？"
        yes-label="确认记下"
        no-label="这次不加"
        :existing-projects="existingProjects"
        @confirm="emit('confirm', $event)"
        @skip="emit('skip')"
      />
      <div v-else-if="awaiting && !streamingReply" class="msg agent typing">
        <div class="who">秘书</div>
        <div class="bubble">···</div>
      </div>
      <div ref="endEl" class="thread-end" />
    </div>
    <div v-if="mode === 'text'" class="composer">
      <div class="composer-shell">
        <input
          v-model="text"
          type="text"
          placeholder="想到什么，直接说…"
          autocomplete="off"
          :disabled="awaiting"
          @focus="onFocusInput"
          @keydown.enter.prevent="onSend"
        />
        <button
          class="tidy"
          type="button"
          aria-label="自动整理待办"
          :disabled="awaiting"
          @click="emit('tidy')"
        >
          自动整理待办
        </button>
        <button class="send" type="button" aria-label="发送" :disabled="awaiting" @click="onSend">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    </div>
    <div v-else class="voice-panel" data-testid="voice-panel">
      <p class="voice-status">{{ voiceStatus }}</p>
      <button
        type="button"
        class="voice-orb"
        :class="phase"
        data-testid="voice-orb"
        :aria-label="orbLabel"
        :disabled="phase === 'transcribing'"
        @click="onVoiceTap"
      >
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      </button>
      <button
        class="tidy"
        type="button"
        aria-label="自动整理待办"
        :disabled="awaiting"
        @click="emit('tidy')"
      >
        自动整理待办
      </button>
      <p v-if="voiceError" class="voice-error" data-voice-error>{{ voiceError }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import TodoConfirm from "@/components/TodoConfirm.vue";
import { parseRichText } from "@/rich-text";
import { ListenCancelled, openMicSession, type MicSession, type UtteranceListener } from "@/speech/listen";
import { cancelSpeech, warmupAudio } from "@/speech/tts";
import type { ChatMessage, ProposedTodo } from "@/types";

const props = defineProps<{
  messages: ChatMessage[];
  awaiting: boolean;
  /** 流式回复中的累积文本；null/空 = 不在流式。只展示，不进 messages。 */
  streamingReply?: string | null;
  pendingPropose: ProposedTodo[] | null;
  proposeKind?: "later" | "today";
  existingProjects?: string[];
  /** 语音转文字：App 注入（拿着设置里的识别凭证）。 */
  recognize?: ((wavBase64: string) => Promise<string>) | null;
  /** 语音回复朗读：App 注入（拿着设置里的百炼凭证合成并播放）。 */
  speakReply?: ((text: string, signal: AbortSignal) => Promise<void>) | null;
}>();

const streamingLines = computed(() => (props.streamingReply ? parseRichText(props.streamingReply) : []));

const emit = defineEmits<{
  send: [text: string];
  tidy: [];
  confirm: [items: ProposedTodo[]];
  skip: [];
}>();

const text = ref("");
const threadEl = ref<HTMLElement | null>(null);
const endEl = ref<HTMLElement | null>(null);
const mode = ref<"text" | "voice">("text");
type VoicePhase = "idle" | "listening" | "recording" | "transcribing" | "waiting" | "speaking";
const phase = ref<VoicePhase>("idle");
const voiceError = ref("");

const voiceStatus = computed(() => {
  if (props.pendingPropose) return "先确认上面的事项";
  switch (phase.value) {
    case "listening":
      return "正在听，说完停一下";
    case "recording":
      return "正在录音…";
    case "transcribing":
      return "识别中…";
    case "waiting":
      return "秘书在想";
    case "speaking":
      return "秘书在说，点一下打断";
    default:
      return "点下面开始说话";
  }
});

const orbLabel = computed(() => {
  if (phase.value === "speaking") return "打断并开始听";
  if (phase.value === "recording" || phase.value === "listening") return "说完了";
  return "语音";
});

function scrollToLatest() {
  const el = threadEl.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
  endEl.value?.scrollIntoView({ block: "end" });
}

let pinLive = true;

function pinToLatest() {
  if (!pinLive) return;
  void nextTick(() => {
    if (!pinLive) return;
    scrollToLatest();
    const raf =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (cb: FrameRequestCallback) => setTimeout(cb, 16);
    raf(() => {
      if (!pinLive) return;
      scrollToLatest();
      raf(() => {
        if (!pinLive) return;
        scrollToLatest();
      });
    });
  });
}

onMounted(() => {
  pinLive = true;
  pinToLatest();
  window.visualViewport?.addEventListener("resize", pinToLatest);
});
onUnmounted(() => {
  pinLive = false;
  window.visualViewport?.removeEventListener("resize", pinToLatest);
  stopVoice();
});
watch(
  () => [props.messages.length, props.messages.at(-1)?.id, props.pendingPropose, props.awaiting, props.streamingReply, mode.value],
  pinToLatest,
  { immediate: true },
);

function onFocusInput() {
  window.scrollTo(0, 0);
  pinToLatest();
}

function onSend() {
  const t = text.value.trim();
  if (!t || props.awaiting) return;
  text.value = "";
  emit("send", t);
}

function setMode(next: "text" | "voice") {
  if (mode.value === next) return;
  mode.value = next;
  voiceError.value = "";
  if (next === "voice") void runVoiceSession();
  else stopVoice();
}

let sessionGen = 0;
let sessionAbort: AbortController | null = null;
let mic: MicSession | null = null;
let listener: UtteranceListener | null = null;
let speakAbort: AbortController | null = null;
let spokenId: string | null = null;

function lastAssistantId(): string | null {
  for (let i = props.messages.length - 1; i >= 0; i--) {
    if (props.messages[i].role === "assistant") return props.messages[i].id;
  }
  return null;
}

function lastAssistantText(): string {
  for (let i = props.messages.length - 1; i >= 0; i--) {
    if (props.messages[i].role === "assistant") return props.messages[i].content;
  }
  return "";
}

function stopVoice() {
  sessionGen += 1;
  sessionAbort?.abort();
  sessionAbort = null;
  listener?.cancel();
  listener = null;
  mic?.close();
  mic = null;
  speakAbort?.abort();
  speakAbort = null;
  cancelSpeech();
  phase.value = "idle";
}

function until(get: () => boolean, signal: AbortSignal, timeoutMs = 0): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || get()) {
      resolve();
      return;
    }
    let timer: number | undefined;
    const stop = watch(get, (ok) => {
      if (ok) {
        cleanup();
        resolve();
      }
    });
    const onAbort = () => {
      cleanup();
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (timeoutMs > 0) {
      timer = window.setTimeout(() => {
        cleanup();
        resolve();
      }, timeoutMs);
    }
    function cleanup() {
      stop();
      signal.removeEventListener("abort", onAbort);
      if (timer !== undefined) window.clearTimeout(timer);
    }
  });
}

async function speakLatest(signal: AbortSignal) {
  const id = lastAssistantId();
  const content = lastAssistantText();
  if (!id || id === spokenId || !content.trim()) return;
  const speakReply = props.speakReply;
  if (!speakReply) {
    spokenId = id;
    return;
  }
  spokenId = id;
  phase.value = "speaking";
  speakAbort?.abort();
  const ac = new AbortController();
  speakAbort = ac;
  const onAbort = () => ac.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    await speakReply(content, ac.signal);
  } catch {
    /* 朗读失败不挡听 */
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (speakAbort === ac) speakAbort = null;
  }
}

async function runVoiceSession() {
  const gen = ++sessionGen;
  sessionAbort?.abort();
  const ac = new AbortController();
  sessionAbort = ac;
  const signal = ac.signal;
  spokenId = lastAssistantId();
  voiceError.value = "";
  const recognize = props.recognize;
  void warmupAudio();

  if (!recognize) {
    voiceError.value = "还没配置语音凭证，去设置页填一下";
    phase.value = "idle";
    return;
  }

  let session: MicSession;
  try {
    session = await openMicSession();
  } catch (e) {
    if (sessionGen !== gen) return;
    voiceError.value = e instanceof Error ? e.message : "打不开麦克风";
    phase.value = "idle";
    return;
  }
  mic = session;
  if (signal.aborted || sessionGen !== gen) {
    session.close();
    if (mic === session) mic = null;
    return;
  }

  try {
  while (!signal.aborted && sessionGen === gen && mode.value === "voice") {
    try {
      if (props.awaiting || props.pendingPropose) {
        listener?.cancel();
        listener = null;
        phase.value = "waiting";
        await until(() => !props.awaiting && !props.pendingPropose, signal);
        if (signal.aborted || sessionGen !== gen) break;
        await speakLatest(signal);
        if (signal.aborted || sessionGen !== gen) break;
        await until(() => false, signal, 280);
        continue;
      }

      phase.value = "listening";
      const turn = session.listen({
        signal,
        onSpeechStart: () => {
          if (sessionGen === gen) phase.value = "recording";
        },
      });
      listener = turn;
      let wav = "";
      try {
        wav = await turn.result;
      } finally {
        if (listener === turn) listener = null;
      }
      if (signal.aborted || sessionGen !== gen) break;
      if (!wav) continue;

      phase.value = "transcribing";
      const said = (await recognize(wav)).trim();
      if (!said) continue;
      if (signal.aborted || sessionGen !== gen) break;
      const prev = lastAssistantId();
      emit("send", said);
      await until(() => props.awaiting, signal, 3000);
      if (signal.aborted || sessionGen !== gen) break;
      await until(() => lastAssistantId() !== prev || !props.awaiting, signal);
      if (signal.aborted || sessionGen !== gen) break;
      await speakLatest(signal);
      if (signal.aborted || sessionGen !== gen) break;
      await until(() => false, signal, 280);
    } catch (e) {
      if (signal.aborted || sessionGen !== gen) break;
      if (e instanceof ListenCancelled || (e instanceof DOMException && e.name === "AbortError")) continue;
      voiceError.value = e instanceof Error ? e.message : "语音出了点问题";
      phase.value = "idle";
      await until(() => false, signal, 1200);
      voiceError.value = "";
    }
  }
  } finally {
    session.close();
    if (mic === session) mic = null;
  }
}

function onVoiceTap() {
  if (phase.value === "idle" && mode.value === "voice") {
    voiceError.value = "";
    void runVoiceSession();
    return;
  }
  voiceError.value = "";
  if (phase.value === "speaking") {
    speakAbort?.abort();
    cancelSpeech();
    return;
  }
  if (phase.value === "listening" || phase.value === "recording") {
    listener?.finish();
  }
}

watch(
  () => [props.awaiting, props.pendingPropose] as const,
  ([awaitingNow, pending]) => {
    if (mode.value !== "voice") return;
    if (awaitingNow || pending) listener?.cancel();
  },
);
</script>
