<template>
  <section class="page" data-module="photo">
    <header class="page-head">
      <div>
        <h2>影像资料管理</h2>
        <p class="page-desc">
          按归属收口：归档后对拍摄人只读；本探方资料员整理本批，跨探方改动一律拦下。归档只能按次序往前推，无存储介质不许归档。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记影像资料</button>
        <button class="btn" type="button" @click="exportRows">导出影像资料清单</button>
        <button class="btn" type="button" @click="syncAll">同步归档结论到简报校核</button>
      </div>
    </header>

    <IdentityBar />

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>归档口径</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td>
            <RouterLink class="link" :to="`/photo/${row.id}`">{{ photoCode(row) }}</RouterLink>
          </td>
          <td>{{ row['拍摄对象'] ?? '—' }}</td>
          <td>{{ row['所属探方'] ?? '—' }}</td>
          <td>{{ row['拍摄方向'] ?? '—' }}</td>
          <td>{{ row['拍摄日期'] ?? '—' }}</td>
          <td>{{ row['拍摄人'] ?? '—' }}</td>
          <td :class="{ 'cell-warn': !mediaText(row) }">
            {{ mediaText(row) || '介质缺失' }}
          </td>
          <td>
            {{ row.status }}
            <span v-if="isLegacyArchive(row)" class="tag tag-legacy" title="归档口径调整后，老影像沿用历史归档结论，不重新判定">历史结论</span>
          </td>
          <td>
            <span v-if="row['归档口径']">{{ row['归档口径'] }}</span>
            <span v-else class="muted-text">—</span>
          </td>
          <td class="row-actions">
            <RouterLink class="link" :to="`/photo/${row.id}`">查看详情</RouterLink>
            <template v-for="item in actionPlan(row)" :key="item.action">
              <button
                class="link"
                type="button"
                :disabled="!item.allowed"
                :title="item.reason"
                @click="runAdvance(item.action, row)"
              >
                {{ item.action }}
              </button>
            </template>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无影像资料数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条影像资料记录（编号与详情页取自同一数据源，列表与详情一致）</span>
      <span v-if="message" class="result-text" :class="messageKind">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import IdentityBar from '@/components/IdentityBar.vue'
import { downloadEntries } from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import {
  advancePhoto,
  availablePhotoActions,
  isLegacyArchive,
  listPhotos,
  photoCode,
  syncArchivedPhotos,
  type PhotoRow,
} from '@/domain/photo-archive'

const store = useSessionStore()

const columns = ['影像编号', '拍摄对象', '所属探方', '拍摄方向', '拍摄日期', '拍摄人', '存储介质']
const filterFields = ['影像编号', '拍摄对象', '所属探方']
const statuses = ['待整理', '已整理', '已归档']

const rows = ref<PhotoRow[]>([])
const total = ref(0)
const message = ref('')
const messageKind = ref('')
const filters = ref<Record<string, string>>({})

const stats = computed(() => [
  { label: '待整理影像', value: rows.value.filter((row) => row.status === '待整理').length },
  { label: '已整理影像', value: rows.value.filter((row) => row.status === '已整理').length },
  { label: '已归档影像', value: rows.value.filter((row) => row.status === '已归档').length },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function mediaText(row: PhotoRow): string {
  return String(row['存储介质'] ?? '').trim()
}

function actionPlan(row: PhotoRow) {
  return availablePhotoActions(row, store.identity)
}

function flash(text: string, ok = true) {
  message.value = text
  messageKind.value = ok ? 'ok-text' : 'error-text'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries('photo')
}

function openCreate() {
  flash('影像资料登记入口尚未接入审批流', false)
}

function runAdvance(action: string, row: PhotoRow) {
  const result = advancePhoto(Number(row.id), action, store.identity)
  flash(result.message, result.ok)
  if (result.ok) {
    reload()
  }
}

function syncAll() {
  const outcome = syncArchivedPhotos(store.identity)
  flash(outcome.message, outcome.rejected.length === 0 && outcome.synced.length > 0)
  reload()
}

function reload() {
  message.value = ''
  rows.value = listPhotos(filters.value)
  total.value = rows.value.length
}

onMounted(reload)
</script>
