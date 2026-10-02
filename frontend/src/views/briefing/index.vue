<template>
  <section class="page" data-module="briefing">
    <header class="page-head">
      <div>
        <h2>简报校核管理</h2>
        <p class="page-desc">维护发掘简报，围绕简报编号、涉及探方、编写人、初稿日期做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记发掘简报</button>
        <button class="btn" type="button" @click="exportRows">导出简报校核清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
      <article class="stat-card stat-accent">
        <span class="stat-label">归档影像待引用</span>
        <strong class="stat-value">{{ pendingCount }}</strong>
      </article>
    </div>

    <section class="citation-panel">
      <h3>归档影像待引用清单</h3>
      <p class="page-desc">
        影像归档处理完成后，有效结论同步到这里作为待引用项；介质缺失等无效记录在归档环节直接退回，不进入本清单。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>影像编号</th>
            <th>所属探方</th>
            <th>拍摄对象</th>
            <th>拍摄人</th>
            <th>归档时间</th>
            <th>归档口径</th>
            <th>引用状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in citations" :key="item.id">
            <td>{{ item['影像编号'] }}</td>
            <td>{{ item['所属探方'] }}</td>
            <td>{{ item['拍摄对象'] }}</td>
            <td>{{ item['拍摄人'] }}</td>
            <td>{{ item['归档时间'] }}</td>
            <td>{{ item['归档口径'] }}</td>
            <td>
              <span class="status-pill" :class="item.status === '待引用' ? 'pill-pending' : 'pill-archived'">
                {{ item.status }}
              </span>
              <span v-if="item['引用简报']" class="cell-sub">已引用：{{ item['引用简报'] }}</span>
            </td>
            <td class="row-actions">
              <button
                v-if="item.status === '待引用'"
                class="link"
                type="button"
                @click="markUsed(item.id)"
              >
                标记已引用
              </button>
              <span v-else class="cell-sub">已闭环</span>
            </td>
          </tr>
          <tr v-if="!citations.length">
            <td colspan="8" class="empty-state">暂无归档影像待引用项；影像确认归档后会自动同步到这里</td>
          </tr>
        </tbody>
      </table>
    </section>

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
import { listCitations, markCitationUsed } from '@/data/photo-citation-store'
import type { EntryRow, PhotoCitation } from '@/data/types'

const meta = moduleMeta('briefing')
const columns = ["简报编号", "涉及探方", "编写人", "初稿日期", "校核意见数", "校核结论", "定稿日期", "简报状态"]
const actions = ["提交校核", "确认定稿", "退回修改"]
const statuses = ["待编写", "待校核", "已定稿", "已退回"]
const stats = [{"label": "待编写简报", "value": 0}, {"label": "待校核简报", "value": 0}, {"label": "本月定稿数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const citations = ref<PhotoCitation[]>([])
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const pendingCount = computed(() => citations.value.filter((item) => item.status === '待引用').length)

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

function markUsed(id: number) {
  errorMessage.value = ''
  markCitationUsed(id, '')
  loadCitations()
}

function loadCitations() {
  citations.value = listCitations()
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

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    loadCitations()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '简报校核列表读取失败'
  }
}

onMounted(reload)
</script>
