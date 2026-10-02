import { listRows, saveRows } from '@/data/local-store'
import { addPhotoCitation } from '@/data/photo-citation-store'
import type { ActionResult, EntryRow } from '@/data/types'

import {
  actionTarget,
  checkFieldUpdate,
  checkPhotoAction,
  CURRENT_ARCHIVE_REVISION,
  hasStorageMedia,
  isLegacyArchive,
  PHOTO_ARCHIVED,
  PHOTO_KEY,
  type PhotoActor,
} from './photo-policy'

export const PHOTO_MODULE_KEY = PHOTO_KEY

function today(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function getPhoto(id: number): EntryRow | null {
  const row = listRows(PHOTO_KEY).find((item) => Number(item.id) === id)
  return row ? { ...row } : null
}

// 影像动作入口：权限、次序、介质都在规则域判；这里只负责落库与跨模块同步。
export function applyPhotoAction(
  actor: PhotoActor | null,
  id: number,
  action: string,
): ActionResult {
  const rows = listRows(PHOTO_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的影像资料` }
  }
  const current = rows[index]
  const guard = checkPhotoAction(actor, current, action)
  if (!guard.ok) {
    return { ok: false, message: guard.reason }
  }

  const target = actionTarget(action)
  const updated: EntryRow = {
    ...current,
    status: target,
    pending: target !== PHOTO_ARCHIVED,
    abnormal: action === '标记重拍',
  }

  let synced = false
  if (target === PHOTO_ARCHIVED) {
    // 走到这里的都通过了现行介质校验；老影像不会再走到本分支，沿用历史结论不重判。
    updated['归档时间'] = today()
    updated['归档结论'] = '归档有效'
    updated['归档口径'] = CURRENT_ARCHIVE_REVISION
    addPhotoCitation({
      photoId: Number(updated.id),
      影像编号: String(updated['影像编号']),
      所属探方: String(updated['所属探方'] ?? ''),
      拍摄对象: String(updated['拍摄对象'] ?? ''),
      拍摄人: String(updated['拍摄人'] ?? ''),
      归档时间: String(updated['归档时间']),
      归档口径: CURRENT_ARCHIVE_REVISION,
    })
    synced = true
  }

  const next = [...rows]
  next[index] = updated
  saveRows(PHOTO_KEY, next)

  if (target === PHOTO_ARCHIVED) {
    return {
      ok: true,
      message: `影像 ${updated['影像编号']} 已按${CURRENT_ARCHIVE_REVISION.split('（')[0]}口径归档，结论已同步到简报校核待引用清单`,
    }
  }
  if (synced) {
    return { ok: true, message: '已处理' }
  }
  return { ok: true, message: `影像 ${updated['影像编号']} 已${action}，当前状态「${target}」` }
}

// 字段整理入口：归档后只读、跨探方拦截、编号不可改，全部在规则域判。
export function updatePhotoField(
  actor: PhotoActor,
  id: number,
  field: string,
  value: string,
): ActionResult {
  const rows = listRows(PHOTO_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的影像资料` }
  }
  const current = rows[index]
  const guard = checkFieldUpdate(actor, current, field)
  if (!guard.ok) {
    return { ok: false, message: guard.reason }
  }
  const updated: EntryRow = { ...current, [field]: value }
  // 异常标记只随介质有无变化：介质缺失的未归档影像标异常提示归档将被退回；
  // v1 历史已归档影像沿用历史结论，即使介质缺失也不标异常、不重判。
  if (field === '存储介质') {
    updated.abnormal = !hasStorageMedia(updated) && !isLegacyArchive(updated)
  }
  const next = [...rows]
  next[index] = updated
  saveRows(PHOTO_KEY, next)
  return { ok: true, message: `影像 ${updated['影像编号']} 的${field}已更新` }
}

// 多字段整批预校验：任一改动越权就整批拦下，不允许先落库一部分再发现跨探方。
export function checkPhotoEdits(
  actor: PhotoActor,
  id: number,
  patch: Record<string, string>,
): ActionResult {
  const row = getPhoto(id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的影像资料` }
  }
  for (const field of Object.keys(patch)) {
    const guard = checkFieldUpdate(actor, row, field)
    if (!guard.ok) {
      return { ok: false, message: guard.reason }
    }
  }
  return { ok: true, message: '' }
}

export function applyPhotoEdits(
  actor: PhotoActor,
  id: number,
  patch: Record<string, string>,
): ActionResult {
  const precheck = checkPhotoEdits(actor, id, patch)
  if (!precheck.ok) {
    return precheck
  }
  const rows = listRows(PHOTO_KEY)
  const index = rows.findIndex((item) => Number(item.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的影像资料` }
  }
  const updated: EntryRow = { ...rows[index], ...patch }
  if (Object.prototype.hasOwnProperty.call(patch, '存储介质')) {
    updated.abnormal = !hasStorageMedia(updated) && !isLegacyArchive(updated)
  }
  const next = [...rows]
  next[index] = updated
  saveRows(PHOTO_KEY, next)
  return { ok: true, message: `影像 ${updated['影像编号']} 的整理结果已保存` }
}
