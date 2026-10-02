<template>
  <section class="page" data-module="photo-detail">
    <header class="page-head">
      <div>
        <h2>影像资料详情</h2>
        <p class="page-desc">
          影像编号与列表页取自同一数据源。归档后对拍摄人只读；本探方资料员整理本批，跨探方改动一律拦下。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/photo">返回影像列表</RouterLink>
      </div>
    </header>

    <IdentityBar />

    <div v-if="!row" class="data-table empty-state" style="padding: 24px">
      没有找到该影像资料，<RouterLink class="link" to="/photo">返回列表</RouterLink>
    </div>

    <template v-else>
      <div class="detail-head">
        <div>
          <span class="detail-code-label">影像编号</span>
          <strong class="detail-code">{{ photoCode(row) }}</strong>
          <span v-if="isLegacyArchive(row)" class="tag tag-legacy" title="归档口径调整后，老影像沿用历史归档结论，不重新判定">
            历史归档结论沿用（{{ row['归档口径'] }}）
          </span>
        </div>
        <span class="tag" :class="statusTagClass">{{ row.status }}</span>
      </div>

      <div class="detail-grid">
        <label v-for="field in editableFields" :key="field" class="detail-field">
          <span>{{ field }}</span>
          <input
            v-model="draft[field]"
            :disabled="!editPermission.allowed"
            :placeholder="field"
          />
        </label>
        <div class="detail-field readonly-field">
          <span>所属探方</span>
          <strong>{{ row['所属探方'] }}</strong>
        </div>
        <div class="detail-field readonly-field">
          <span>拍摄人</span>
          <strong>{{ row['拍摄人'] }}</strong>
        </div>
      </div>

      <p v-if="!editPermission.allowed" class="lock-note">{{ editPermission.reason }}</p>
      <p v-else-if="row.status === '已归档'" class="lock-note">当前管理员维护模式；业务角色对已归档影像均为只读。</p>

      <div class="detail-actions">
        <button
          class="btn primary"
          type="button"
          :disabled="!editPermission.allowed"
          :title="editPermission.reason"
          @click="saveEdit"
        >
          保存修改
        </button>
        <button
          v-for="item in actionPlan"
          :key="item.action"
          class="btn"
          type="button"
          :disabled="!item.allowed"
          :title="item.reason"
          @click="runAdvance(item.action)"
        >
          {{ item.action }}
        </button>
        <button class="btn" type="button" @click="syncOne">同步归档结论到简报校核</button>
      </div>

      <table v-if="archiveFields.length" class="data-table archive-table">
        <thead>
          <tr><th>归档痕迹</th><th>内容</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in archiveFields" :key="item.label">
            <td>{{ item.label }}</td>
            <td>{{ item.value }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <footer class="page-foot">
      <span>本页编号与列表页一致，均取自影像登记中的「影像编号」字段</span>
      <span v-if="message" class="result-text" :class="messageKind">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import IdentityBar from '@/components/IdentityBar.vue'
import { useSessionStore } from '@/stores/session'
import {
  advancePhoto,
  availablePhotoActions,
  canEditPhoto,
  getPhoto,
  isLegacyArchive,
  photoCode,
  syncSinglePhoto,
  updatePhoto,
  type PhotoRow,
} from '@/domain/photo-archive'

const route = useRoute()
const store = useSessionStore()

const editableFields = ['拍摄对象', '拍摄方向', '拍摄日期', '存储介质', '文件规格']
const traceLabels: Record<string, string> = {
  归档口径: '归档口径',
  归档结论: '归档结论',
  归档人: '归档人',
  归档时间: '归档时间',
  整理人: '整理人',
  整理时间: '整理时间',
  最近修改人: '最近修改人',
  最近修改时间: '最近修改时间',
  最近退回原因: '最近退回原因',
}

const row = ref<PhotoRow | undefined>()
const draft = reactive<Record<string, string>>({})
const message = ref('')
const messageKind = ref('')

const photoId = computed(() => Number(route.params.id))
const editPermission = computed(() =>
  row.value ? canEditPhoto(store.identity, row.value) : { allowed: false, reason: '' },
)
const actionPlan = computed(() =>
  row.value ? availablePhotoActions(row.value, store.identity) : [],
)
const statusTagClass = computed(() => ({
  'tag-status': true,
  'tag-archived': row.value?.status === '已归档',
}))

const archiveFields = computed(() => {
  if (!row.value) {
    return []
  }
  return Object.entries(traceLabels)
    .map(([key, label]) => ({ label, value: String(row.value?.[key] ?? '').trim() }))
    .filter((item) => item.value !== '')
})

function fillDraft(source: PhotoRow) {
  for (const field of editableFields) {
    draft[field] = String(source[field] ?? '')
  }
}

function flash(text: string, ok = true) {
  message.value = text
  messageKind.value = ok ? 'ok-text' : 'error-text'
}

function reload() {
  message.value = ''
  row.value = getPhoto(photoId.value)
  if (row.value) {
    fillDraft(row.value)
  }
}

function saveEdit() {
  if (!row.value) {
    return
  }
  const result = updatePhoto(Number(row.value.id), { ...draft }, store.identity)
  flash(result.message, result.ok)
  if (result.ok) {
    reload()
  }
}

function runAdvance(action: string) {
  if (!row.value) {
    return
  }
  const result = advancePhoto(Number(row.value.id), action, store.identity)
  flash(result.message, result.ok)
  if (result.ok) {
    reload()
  }
}

function syncOne() {
  if (!row.value) {
    return
  }
  const result = syncSinglePhoto(Number(row.value.id), store.identity)
  flash(result.message, result.ok)
  reload()
}

watch(
  () => store.identity.name,
  () => {
    message.value = ''
  },
)

onMounted(reload)
</script>
