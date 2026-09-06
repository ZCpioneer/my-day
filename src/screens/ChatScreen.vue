<template>
  <section class="screen on">
    <div ref="threadEl" class="thread">
      <div v-if="messages.length === 0 && !pendingPropose && !awaiting" class="empty">
        <div class="glyph">朝暮</div>
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
        <div class="who">{{ m.role === "user" ? "我" : "朝暮" }}</div>
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
      <TodoConfirm
        v-if="pendingPropose && proposeKind === 'today'"
        :items="pendingPropose"
        heading="这样排可以吗？"
        yes-label="确认这次整理"
        no-label="先不定"
        note="确认后这段对话会清空，可以重新聊。"
        @confirm="emit('confirm', $event)"
        @skip="emit('skip')"
      />
      <TodoConfirm
        v-else-if="pendingPropose"
        :items="pendingPropose"
        heading="记到「以后」吗？"
        yes-label="确认记下"
        no-label="这次不加"
        @confirm="emit('confirm', $event)"
        @skip="emit('skip')"
      />
      <div v-else-if="awaiting" class="msg agent typing">
        <div class="who">朝暮</div>
        <div class="bubble">···</div>
      </div>
      <div ref="endEl" class="thread-end" />
    </div>
    <div class="composer">
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
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import TodoConfirm from "@/components/TodoConfirm.vue";
import { parseRichText } from "@/rich-text";
import type { ChatMessage, ProposedTodo } from "@/types";

const props = defineProps<{
  messages: ChatMessage[];
  awaiting: boolean;
  pendingPropose: ProposedTodo[] | null;
  proposeKind?: "later" | "today";
}>();

const emit = defineEmits<{
  send: [text: string];
  tidy: [];
  confirm: [items: ProposedTodo[]];
  skip: [];
}>();

const text = ref("");
const threadEl = ref<HTMLElement | null>(null);
const endEl = ref<HTMLElement | null>(null);

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
});
watch(
  () => [props.messages.length, props.messages.at(-1)?.id, props.pendingPropose, props.awaiting],
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
</script>
