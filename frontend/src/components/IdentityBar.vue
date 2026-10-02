<template>
  <div class="identity-bar">
    <label class="identity-select">
      <span>当前身份（归属收口演示）</span>
      <select
        :value="store.identity.name"
        @change="onChange(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="item in store.identityRoster" :key="item.name" :value="item.name">
          {{ item.name }} · {{ item.role }}{{ item.trench ? ` · ${item.trench}` : '' }}
        </option>
      </select>
    </label>
    <p class="identity-hint">{{ hint }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

function onChange(name: string) {
  const target = store.identityRoster.find((item) => item.name === name)
  if (target) {
    store.switchIdentity(target)
  }
}

const hint = computed(() => {
  const { role, trench } = store.identity
  if (role === '拍摄人') {
    return '拍摄人：只能修改本人拍摄且未归档的影像；归档后只读。整理与归档需由本探方资料员办理。'
  }
  if (role === '资料员') {
    return `资料员（${trench}）：只能整理本探方的影像，跨探方改动一律拦下；归档必须有存储介质，且只能按次序往前推。`
  }
  return '管理员：可代为维护资料；归档锁定与状态次序规则同样生效。'
})
</script>
