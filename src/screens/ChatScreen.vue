<template>
  <section class="screen on">
    <div ref="threadEl" class="thread">
      <div v-if="messages.length === 0 && !pendingPropose" class="empty">
        <div class="glyph">{{ period === "evening" ? "暮" : "朝" }}</div>
        <p v-if="period === 'evening'">
          点「暮」会清空今晚这场对话，立刻按待办回顾。<br />只整理完成情况，不当陪聊。
        </p>
        <p v-else>
          点「朝」会清空今早这场对话，立刻按已有待办开始整理。<br />只把今天要做的事理清楚。
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
        v-if="pendingPropose"
        :items="pendingPropose"
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
  period: "morning" | "evening";
}>();

const emit = defineEmits<{
  send: [text: string];
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
