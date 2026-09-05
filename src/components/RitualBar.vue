<template>
  <div class="ritual">
    <button
      class="morning"
      type="button"
      :class="{ active: morningActive }"
      :disabled="disabled"
      @click="emit('morning')"
    >
      <strong>朝</strong>
      <small>开始今天</small>
    </button>
    <button
      class="evening"
      type="button"
      :class="{ active: eveningActive }"
      :disabled="disabled"
      @click="emit('evening')"
    >
      <strong>暮</strong>
      <small>回顾今天</small>
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  disabled?: boolean;
  morningActive?: boolean;
  eveningActive?: boolean;
}>();

const emit = defineEmits<{
  morning: [];
  evening: [];
}>();
</script>
