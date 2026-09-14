<template>
  <div
    class="log-card"
    :class="{ 'log-card--collapsible': collapsible, 'log-card--collapsed': collapsed }"
    :data-log-day="log.date"
    :aria-expanded="collapsible ? !collapsed : undefined"
    @click="onCardClick"
  >
    <div class="log-core">
      <div class="log-mast">
        <div class="log-mast-when">
          <span v-if="kicker" class="log-kicker">{{ kicker }}</span>
          <span class="log-when">{{ whenLabel }}</span>
        </div>
        <span v-if="log.mood" class="mood-emoji" data-log-mood>{{ log.mood }}</span>
      </div>
      <template v-if="!editing">
        <p class="log-state" :class="{ 'log-state--clamp': collapsed }" data-log-state>{{ log.state }}</p>
        <p v-if="!collapsed && log.cheer" class="log-cheer" data-log-cheer>{{ log.cheer }}</p>
        <div v-if="!collapsed" class="log-actions">
          <button type="button" class="log-edit-btn" data-log-edit @click.stop="startEdit">编辑</button>
        </div>
      </template>
      <template v-else>
        <div class="log-block">
          <div class="lab">状态</div>
          <div class="log-mood-row">
            <input v-model="draftMood" class="log-mood-input" data-log-edit-mood maxlength="4" placeholder="emoji" />
            <textarea v-model="draftState" class="log-textarea" data-log-edit-state rows="4"></textarea>
          </div>
        </div>
        <div class="log-block">
          <div class="lab">秘书寄语</div>
          <textarea v-model="draftCheer" class="log-textarea" data-log-edit-cheer rows="2"></textarea>
        </div>
        <div class="log-actions">
          <button type="button" class="log-edit-btn" data-log-edit-cancel @click.stop="cancelEdit">取消</button>
          <button
            type="button"
            class="log-edit-btn log-edit-btn--primary"
            data-log-edit-save
            :disabled="!canSave"
            @click.stop="saveEdit"
          >
            保存
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { dayLabel, dayNumLabel, weekdayLabel } from "@/dates";
import type { DailyLog } from "@/types";

const props = withDefaults(
  defineProps<{
    log: DailyLog;
    kicker?: string;
    collapsible?: boolean;
    collapsed?: boolean;
  }>(),
  { collapsible: false, collapsed: false },
);

const emit = defineEmits<{ save: [log: DailyLog]; toggle: [] }>();

const whenLabel = computed(() =>
  props.kicker
    ? `${dayLabel(props.log.date)} · ${weekdayLabel(props.log.date)}`
    : `${dayNumLabel(props.log.date)} ${weekdayLabel(props.log.date)}`,
);

const editing = ref(false);
const draftState = ref("");
const draftMood = ref("");
const draftCheer = ref("");

const canSave = computed(() => draftState.value.trim().length > 0);

function onCardClick(e: MouseEvent) {
  if (!props.collapsible || editing.value) return;
  const el = e.target as HTMLElement | null;
  if (el?.closest("button, input, textarea")) return;
  emit("toggle");
}

function startEdit() {
  draftState.value = props.log.state;
  draftMood.value = props.log.mood ?? "";
  draftCheer.value = props.log.cheer ?? "";
  editing.value = true;
}

function cancelEdit() {
  editing.value = false;
}

function saveEdit() {
  if (!canSave.value) return;
  editing.value = false;
  const mood = draftMood.value.trim();
  const cheer = draftCheer.value.trim();
  emit("save", {
    ...props.log,
    state: draftState.value.trim(),
    mood: mood || undefined,
    cheer: cheer || undefined,
    updatedAt: new Date().toISOString(),
  });
}
</script>
