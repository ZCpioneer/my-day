<template>
  <div class="ritual">
    <button class="morning" type="button" @click="emit('morning')">
      <strong>朝</strong>
      <small>开始今天</small>
    </button>
    <button class="evening" type="button" @click="emit('evening')">
      <strong>暮</strong>
      <small>回顾今天</small>
    </button>
  </div>
</template>

<script setup lang="ts">
const emit = defineEmits<{
  morning: [];
  evening: [];
}>();
</script>
