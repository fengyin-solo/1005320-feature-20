<template>
  <section class="page" data-module="photo-detail">
    <header class="page-head">
      <div>
        <h2>
          影像详情
          <span class="detail-code">{{ row?.['影像编号'] }}</span>
        </h2>
        <p class="page-desc">
          <RouterLink class="link" to="/photo">← 返回影像资料列表</RouterLink>
          列表页与详情页共用同一影像编号，编号只读、不可修改。
        </p>
      </div>
    </header>

    <p v-if="!row" class="error-text">没有找到这条影像资料，可能已被重置回示例数据。</p>

    <template v-else>
      <p v-if="locked" class="scope-banner scope-locked">
        该影像已于 {{ row['归档时间'] }} 按{{ row['归档口径'] }}归档，结论「{{ row['归档结论'] }}」。
        归档后对拍摄人及所有角色只读，只能查看，不能再改动拍摄方向等任何字段。
      </p>
      <p v-else-if="crossTrench" class="scope-banner scope-block">
        该影像归属探方 {{ row['所属探方'] }}，不属于你负责的 {{ store.trench }} 批次，跨探方改动已拦下，你只能查看。
      </p>
      <p v-else-if="store.role === 'photographer' && !ownPhoto" class="scope-banner scope-block">
        该影像由 {{ row['拍摄人'] }} 拍摄，你只能查看，不能改动他人影像。
      </p>
      <p v-else class="scope-banner scope-open">
        当前身份：{{ store.roleLabel }}（{{ store.operator }}）——{{ scopeHint }}
      </p>

      <div class="detail-grid">
        <article v-for="field in viewFields" :key="field" class="detail-field">
          <span class="detail-label">{{ field }}</span>
          <template v-if="field === '存储介质' && !mediaPresent">
            <strong v-if="isLegacyArchive(row)" class="tag tag-history">介质缺失 · 历史归档结论沿用，不重判</strong>
            <strong v-else class="tag tag-invalid">未登记介质，归档将按无效记录退回</strong>
          </template>
          <strong v-else>{{ row[field] || '—' }}</strong>
        </article>
        <article class="detail-field">
          <span class="detail-label">当前状态</span>
          <strong><span class="status-pill" :class="statusClass(row.status)">{{ row.status }}</span></strong>
        </article>
      </div>

      <section v-if="!locked" class="edit-panel">
        <h3>整理登记内容</h3>
        <p class="page-desc">
          本探方资料员可整理归属本批次的影像；所属探方只能由管理员调整；影像编号任何角色都不能改。
        </p>
        <div class="edit-grid">
          <label v-for="field in editableFields" :key="field" class="filter-item">
            <span>{{ field }}</span>
            <input v-model="drafts[field]" :disabled="!canEditField(field)" />
          </label>
          <label class="filter-item">
            <span>所属探方（仅管理员）</span>
            <input v-model="drafts['所属探方']" :disabled="!canEditField('所属探方')" />
          </label>
        </div>
        <div class="page-actions">
          <button class="btn primary" type="button" @click="saveEdits">保存整理结果</button>
        </div>
      </section>

      <section class="action-panel">
        <h3>状态流转</h3>
        <p class="page-desc">归档只能按「待整理 → 已整理 → 已归档」次序推进，不允许跳级或把已归档改回待整理。</p>
        <div class="page-actions">
          <button
            v-for="action in actions"
            :key="action.name"
            class="btn"
            :class="{ primary: action.ok, ghost: !action.ok }"
            type="button"
            :disabled="!action.ok"
            :title="action.reason"
            @click="runAction(action.name)"
          >
            {{ action.name }}
          </button>
        </div>
      </section>

      <section v-if="locked && citation" class="action-panel">
        <h3>简报校核同步</h3>
        <p class="page-desc">
          归档结论已同步到简报校核待引用清单：清单状态「{{ citation.status }}」
          <template v-if="citation['引用简报']">，已由 {{ citation['引用简报'] }} 引用。</template>
        </p>
      </section>
    </template>

    <footer class="page-foot">
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { listEntries } from '@/api/local-service'
import { listCitations } from '@/data/photo-citation-store'
import type { EntryRow, PhotoCitation } from '@/data/types'
import {
  checkFieldUpdate,
  checkPhotoAction,
  isArchived,
  isLegacyArchive,
  hasStorageMedia,
  PHOTO_EDITABLE_FIELDS,
} from '@/domain/photo-policy'
import { applyPhotoAction, applyPhotoEdits, getPhoto } from '@/domain/photo-service'
import { useSessionStore } from '@/stores/session'

const route = useRoute()
const store = useSessionStore()

const photoId = Number(route.params.id)
const row = ref<EntryRow | null>(null)
const citation = ref<PhotoCitation | null>(null)
const errorMessage = ref('')
const noticeMessage = ref('')

const viewFields = [
  '影像编号', '所属探方', '拍摄对象', '拍摄方向', '拍摄日期',
  '拍摄人', '存储介质', '文件规格', '归档时间', '归档结论', '归档口径',
]
const editableFields = PHOTO_EDITABLE_FIELDS
const drafts = reactive<Record<string, string>>({})

const locked = computed(() => (row.value ? isArchived(row.value) : false))
const mediaPresent = computed(() => (row.value ? hasStorageMedia(row.value) : false))
const ownPhoto = computed(() =>
  row.value ? String(row.value['拍摄人'] ?? '') === store.operator : false,
)
const crossTrench = computed(
  () => store.role === 'clerk' && !!row.value && String(row.value['所属探方'] ?? '') !== store.trench,
)

const scopeHint = computed(() => {
  if (store.role === 'admin') return '可整理全部探方未归档影像，但不能突破归档锁定与状态次序'
  if (store.role === 'clerk') return `只能整理 ${store.trench} 本探方批次`
  return ownPhoto.value ? '可修正本人拍摄件的登记内容，整理/归档由资料员收口' : '只能查看'
})

const actions = computed(() => {
  if (!row.value) {
    return []
  }
  return ['提交整理', '确认归档', '标记重拍'].map((name) => {
    const result = checkPhotoAction(store.photoActor, row.value as EntryRow, name)
    return { name, ok: result.ok, reason: result.reason }
  })
})

function fillDrafts() {
  if (!row.value) {
    return
  }
  for (const field of [...editableFields, '所属探方']) {
    drafts[field] = String(row.value[field] ?? '')
  }
}

function canEditField(field: string): boolean {
  if (!row.value) {
    return false
  }
  return checkFieldUpdate(store.photoActor, row.value, field).ok
}

function statusClass(status: string): string {
  if (status === '已归档') return 'pill-archived'
  if (status === '待重拍') return 'pill-reject'
  if (status === '已整理') return 'pill-ready'
  return 'pill-pending'
}

function reload() {
  errorMessage.value = ''
  const latest = getPhoto(photoId)
  row.value = latest
  citation.value = listCitations().find((item) => item.photoId === photoId) ?? null
  fillDrafts()
  // 触发一次列表数据装配，保证本地存储缓存与页面一致
  listEntries('photo')
}

function saveEdits() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const fields = [...editableFields, '所属探方']
  const patch: Record<string, string> = {}
  for (const field of fields) {
    if (row.value && drafts[field] !== String(row.value[field] ?? '')) {
      patch[field] = drafts[field]
    }
  }
  if (!Object.keys(patch).length) {
    errorMessage.value = '没有检测到字段改动'
    return
  }
  // 整批预校验：含跨探方/归档锁定/编号修改时整体拦下，不会落库一半
  const result = applyPhotoEdits(store.photoActor, photoId, patch)
  if (!result.ok) {
    errorMessage.value = result.message
    reload()
    return
  }
  reload()
  noticeMessage.value = result.message
}

function runAction(name: string) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyPhotoAction(store.photoActor, photoId, name)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

watch(() => [store.operator, store.role, store.trench], () => {
  errorMessage.value = ''
})

onMounted(reload)
</script>
