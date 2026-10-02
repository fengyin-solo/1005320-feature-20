<template>
  <section class="page" data-module="photo">
    <header class="page-head">
      <div>
        <h2>影像资料管理</h2>
        <p class="page-desc">影像按探方归属收口：归档后对拍摄人只读；资料员只整理本探方批次，跨探方改动一律拦下；归档按「待整理 → 已整理 → 已归档」次序推进。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记影像资料</button>
        <button class="btn" type="button" @click="exportRows">导出影像资料清单</button>
      </div>
    </header>

    <p class="scope-banner" :class="`scope-${store.role}`">
      当前身份：{{ store.roleLabel }}（{{ store.operator }}）——{{ scopeHint }}
    </p>

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
      <label v-for="field in filterFields" :key="field.name" class="filter-item">
        <span>{{ field.name }}</span>
        <input v-model="filters[field.key]" :placeholder="`按${field.name}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td>
            <RouterLink class="link" :to="`/photo/${row.id}`">{{ row['影像编号'] }}</RouterLink>
          </td>
          <td>{{ row['所属探方'] || '—' }}</td>
          <td>{{ row['拍摄对象'] ?? '—' }}</td>
          <td>{{ row['拍摄方向'] ?? '—' }}</td>
          <td>{{ row['拍摄日期'] ?? '—' }}</td>
          <td>{{ row['拍摄人'] ?? '—' }}</td>
          <td>
            <span v-if="hasMedia(row)">{{ row['存储介质'] }}</span>
            <span v-else-if="isLegacyArchive(row)" class="tag tag-history">介质缺失 · 历史口径不重判</span>
            <span v-else class="tag tag-invalid">介质缺失 · 归档将退回</span>
          </td>
          <td>{{ row['文件规格'] ?? '—' }}</td>
          <td>{{ row['归档时间'] || '—' }}</td>
          <td>
            <template v-if="isArchived(row)">
              <span class="tag tag-archived">{{ row['归档结论'] }}</span>
              <span class="cell-sub">{{ row['归档口径'] }}</span>
            </template>
            <span v-else>—</span>
          </td>
          <td>
            <span class="status-pill" :class="statusClass(row.status)">{{ row.status }}</span>
            <span v-if="isArchived(row)" class="cell-sub">归档后只读</span>
          </td>
          <td class="row-actions">
            <template v-if="available(row).length">
              <button
                v-for="action in available(row)"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <button
              v-for="action in disabledActions(row)"
              :key="action.name"
              class="link link-disabled"
              type="button"
              :title="action.reason"
              @click="reportDeny(action.reason)"
            >
              {{ action.name }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无影像资料数据，可先登记影像资料</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条影像资料记录；编号为只读主键，点击编号进入详情核对</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import {
  availableActions,
  denyReason,
  isArchived,
  isLegacyArchive,
  hasStorageMedia as hasMedia,
} from '@/domain/photo-policy'
import { applyPhotoAction } from '@/domain/photo-service'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const meta = moduleMeta('photo')
const columns = ["影像编号", "所属探方", "拍摄对象", "拍摄方向", "拍摄日期", "拍摄人", "存储介质", "文件规格", "归档时间", "归档结论"]
const allActions = ["提交整理", "确认归档", "标记重拍"]
const statuses = ["待整理", "已整理", "已归档", "待重拍"]

const filterFields = [
  { name: '影像编号', key: '影像编号' },
  { name: '所属探方', key: '所属探方' },
  { name: '拍摄对象', key: '拍摄对象' },
]

const scopeHint = computed(() => {
  if (store.role === 'admin') return '全探方可操作，但归档锁定与状态次序不可突破'
  if (store.role === 'clerk') return `只可整理 ${store.trench} 的批次，跨探方动作会被拦下`
  return '归档后影像只读；未归档影像只能改本人拍摄件的登记内容，无权整理/归档'
})

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

const stats = computed(() => [
  { label: '待整理影像', value: rows.value.filter((row) => row.status === '待整理').length },
  { label: '已整理待归档', value: rows.value.filter((row) => row.status === '已整理').length },
  { label: '已归档影像', value: rows.value.filter((row) => row.status === '已归档').length },
  { label: '待重拍影像', value: rows.value.filter((row) => row.status === '待重拍').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function available(row: EntryRow): string[] {
  return availableActions(store.photoActor, row, allActions)
}

function disabledActions(row: EntryRow): { name: string; reason: string }[] {
  return allActions
    .filter((action) => !available(row).includes(action))
    .map((action) => ({ name: action, reason: denyReason(store.photoActor, row, action) }))
}

function statusClass(status: string): string {
  if (status === '已归档') return 'pill-archived'
  if (status === '待重拍') return 'pill-reject'
  if (status === '已整理') return 'pill-ready'
  return 'pill-pending'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '影像资料登记入口尚未接入审批流'
}

function reportDeny(reason: string) {
  errorMessage.value = reason
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyPhotoAction(store.photoActor, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '影像资料列表读取失败'
  }
}

onMounted(reload)
</script>
