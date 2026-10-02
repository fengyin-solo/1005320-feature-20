<template>
  <section class="page" data-module="briefing">
    <header class="page-head">
      <div>
        <h2>简报校核管理</h2>
        <p class="page-desc">维护发掘简报，围绕简报编号、涉及探方、编写人、初稿日期做登记、筛选与状态流转；影像归档结论同步到下方待引用清单。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记发掘简报</button>
        <button class="btn" type="button" @click="syncFromPhoto">同步影像归档结论</button>
        <button class="btn" type="button" @click="exportRows">导出简报校核清单</button>
      </div>
    </header>

    <div class="ref-panel">
      <div class="ref-panel-head">
        <div>
          <h3>影像归档待引用清单</h3>
          <p class="page-desc">归档处理完的有效结论在此多一条「待引用」项；介质缺失这类无效记录直接退回，不进清单；历史归档结论沿用、不重新判定。</p>
        </div>
        <div class="ref-stat">
          <span class="legend-item">待引用：{{ pendingRefs.length }}</span>
          <span class="legend-item">已引用：{{ citedRefs.length }}</span>
        </div>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>影像编号</th>
            <th>所属探方</th>
            <th>拍摄人</th>
            <th>归档结论</th>
            <th>归档口径</th>
            <th>同步时间</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="ref in refs" :key="String(ref.id)">
            <td>{{ ref['影像编号'] }}</td>
            <td>{{ ref['所属探方'] }}</td>
            <td>{{ ref['拍摄人'] }}</td>
            <td>{{ ref['归档结论'] }}</td>
            <td>{{ ref['归档口径'] }}</td>
            <td>{{ ref['同步时间'] }}</td>
            <td>
              {{ ref.status }}
              <span v-if="String(ref['归档结论'] ?? '').includes('历史')" class="tag tag-legacy">历史结论</span>
            </td>
            <td class="row-actions">
              <button
                v-if="ref.status === '待引用'"
                class="link"
                type="button"
                @click="citeRef(Number(ref.id))"
              >
                标记已引用
              </button>
              <span v-else class="muted-text">引用于 {{ ref['引用时间'] }}</span>
            </td>
          </tr>
          <tr v-if="!refs.length">
            <td colspan="8" class="empty-state">还没有归档待引用项，点击「同步影像归档结论」拉取最新归档结果</td>
          </tr>
        </tbody>
      </table>
      <footer v-if="refMessage" class="page-foot">
        <span class="result-text" :class="refMessageKind">{{ refMessage }}</span>
      </footer>
    </div>

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
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无简报校核数据，可先登记发掘简报</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条简报校核记录</span>
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
  runAction as applyAction,
} from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import {
  listArchivedBriefingRefs,
  markBriefingRefCited,
  syncArchivedPhotos,
  type BriefingRef,
} from '@/domain/photo-archive'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('briefing')
const store = useSessionStore()
const columns = ['简报编号', '涉及探方', '编写人', '初稿日期', '校核意见数', '校核结论', '定稿日期', '简报状态']
const actions = ['提交校核', '确认定稿', '退回修改']
const statuses = ['待编写', '待校核', '已定稿', '已退回']
const stats = [{ label: '待编写简报', value: 0 }, { label: '待校核简报', value: 0 }, { label: '本月定稿数', value: 0 }]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const refs = ref<BriefingRef[]>([])
const pendingRefs = computed(() => refs.value.filter((item) => item.status === '待引用'))
const citedRefs = computed(() => refs.value.filter((item) => item.status === '已引用'))
const refMessage = ref('')
const refMessageKind = ref('')

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '发掘简报登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reloadRefs() {
  refs.value = listArchivedBriefingRefs()
}

function syncFromPhoto() {
  const outcome = syncArchivedPhotos(store.identity)
  refMessage.value = outcome.message
  refMessageKind.value = outcome.rejected.length > 0 ? 'error-text' : 'ok-text'
  reloadRefs()
}

function citeRef(id: number) {
  const result = markBriefingRefCited(id)
  refMessage.value = result.message
  refMessageKind.value = result.ok ? 'ok-text' : 'error-text'
  reloadRefs()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '简报校核列表读取失败'
  }
}

onMounted(() => {
  reload()
  reloadRefs()
})
</script>
