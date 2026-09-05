<template>
  <section class="screen on">
    <div ref="threadEl" class="thread">
      <div v-if="messages.length === 0 && !pendingPropose" class="empty">
        <div class="glyph">朝暮</div>
        <p>
          想到什么直接说。<br />聊完点发送左边的「自动整理」，刷新今天的待办。
        </p>
      </div>
      <div
        v-for="m in messages"
        :key="m.id"
        class="msg"
        :class="m.role === 'user' ? 'me' : 'agent'"
      >
        <div class="who">{{ m.role === "user" ? "我" : "朝暮" }}</div>
        <div class="bubble">{{ m.content }}</div>
      </div>
      <TodoConfirm
        v-if="pendingPropose && proposeKind === 'today'"
        :items="pendingPropose"
        heading="今天做这几件？"
        yes-label="确认今日计划"
        no-label="先不定"
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
    </div>
    <div class="composer">
      <div class="composer-shell">
        <input
          v-model="text"
          type="text"
          placeholder="想到什么，直接说…"
          autocomplete="off"
          :disabled="awaiting"
          @keydown.enter.prevent="onSend"
        />
        <button
          class="tidy"
          type="button"
          aria-label="自动整理"
          :disabled="awaiting"
          @click="emit('tidy')"
        >
          自动整理
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
import { nextTick, ref, watch } from "vue";
import TodoConfirm from "@/components/TodoConfirm.vue";
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

watch(
  () => [props.messages.length, props.pendingPropose, props.awaiting],
  async () => {
    await nextTick();
    if (threadEl.value) threadEl.value.scrollTop = threadEl.value.scrollHeight;
  },
);

function onSend() {
  const t = text.value.trim();
  if (!t || props.awaiting) return;
  text.value = "";
  emit("send", t);
}
</script>
