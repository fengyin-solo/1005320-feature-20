import type { EntryRow } from '@/data/types'

// 影像归档规则域：页面、本地服务共用这一份判定，规则只在这里维护。
//
// 归属口径：
//   1. 影像归档后对所有人只读（含拍摄人），只能查看，不能改字段、不能改状态；
//   2. 资料员只能整理自己所属探方的那批，跨探方改动一律拦下；
//   3. 管理员可以跨探方，但同样突破不了归档锁定和状态次序。
// 状态口径：
//   待整理 → 已整理 → 已归档，只许按次序往前推；
//   不许跳级（待整理不能直接归档），也不许把已归档改回待整理；
//   待重拍属于返工分支，与归档链互斥，重拍件必须重新登记再回到待整理。
// 介质口径：
//   现行 v2 口径下没有存储介质的影像不许归档，直接退回；
//   已经按 v1 历史口径归档的老影像沿用历史结论，不重判、不补卡。

export type PhotoRole = 'admin' | 'clerk' | 'photographer'

export type PhotoActor = {
  name: string
  role: PhotoRole
  trench: string
}

export const PHOTO_KEY = 'photo'
export const PHOTO_ARCHIVED = '已归档'
export const CURRENT_ARCHIVE_REVISION = 'v2（现行归档口径：存储介质必验）'

// 每个动作允许的「源状态」：不在表里就不许做，从根上挡住跳级和回退。
const ALLOWED_SOURCES: Record<string, string[]> = {
  提交整理: ['待整理'],
  确认归档: ['已整理'],
  标记重拍: ['待整理', '已整理'],
}

// 详情页允许整理的登记字段；影像编号不在内（编号只读，列表/详情始终一致）。
const EDITABLE_FIELDS = ['拍摄对象', '拍摄方向', '拍摄日期', '存储介质', '文件规格'] as const
export type PhotoEditableField = (typeof EDITABLE_FIELDS)[number]
export const PHOTO_EDITABLE_FIELDS: string[] = [...EDITABLE_FIELDS]

export function isArchived(row: EntryRow): boolean {
  return String(row.status) === PHOTO_ARCHIVED
}

// 老影像（v1 口径归档）沿用历史结论：即使现在介质为空，也不按现行口径重判。
export function isLegacyArchive(row: EntryRow): boolean {
  return isArchived(row) && !String(row['归档口径'] ?? '').startsWith('v2')
}

export function hasStorageMedia(row: EntryRow): boolean {
  return String(row['存储介质'] ?? '').trim() !== ''
}

export function rowTrench(row: EntryRow): string {
  return String(row['所属探方'] ?? '').trim()
}

export type PermissionResult = { ok: boolean; reason: string }

export function archivedDeny(row: EntryRow): PermissionResult | null {
  if (!isArchived(row)) {
    return null
  }
  return {
    ok: false,
    reason: `影像 ${row['影像编号']} 已归档（${row['归档时间'] || '历史归档'}），归档结论已锁定，只能查看，不能再改动拍摄方向等任何内容`,
  }
}

// 归属校验：资料员只放本探方；摄影师只能动自己拍的未归档影像；管理员全探方可操作。
export function checkOwnership(actor: PhotoActor, row: EntryRow): PermissionResult {
  const locked = archivedDeny(row)
  if (locked) {
    return locked
  }
  if (actor.role === 'admin') {
    return { ok: true, reason: '' }
  }
  if (actor.role === 'clerk') {
    if (!actor.trench) {
      return { ok: false, reason: '当前资料员身份没有分配所属探方，不能整理任何影像批次' }
    }
    if (rowTrench(row) !== actor.trench) {
      return {
        ok: false,
        reason: `影像 ${row['影像编号']} 归属探方 ${rowTrench(row) || '（未填写）'}，不属于你负责的 ${actor.trench} 批次，跨探方改动一律拦下`,
      }
    }
    return { ok: true, reason: '' }
  }
  // 摄影师只能改自己拍摄的未归档影像，且不能替别人做整理/归档结论。
  if (String(row['拍摄人'] ?? '') !== actor.name) {
    return {
      ok: false,
      reason: `影像 ${row['影像编号']} 由 ${row['拍摄人'] || '他人'} 拍摄，你只能查看，不能改动他人影像`,
    }
  }
  return { ok: true, reason: '' }
}

// 状态流转校验：先过归属，再过次序，归档动作最后验介质。
export function checkPhotoAction(
  actor: PhotoActor | null,
  row: EntryRow,
  action: string,
): PermissionResult {
  if (actor) {
    const owned = checkOwnership(actor, row)
    if (!owned.ok) {
      return owned
    }
    if (actor.role === 'photographer') {
      return {
        ok: false,
        reason: '拍摄人只能登记和查看影像，整理与归档结论由本探方资料员收口，拍摄人无权执行',
      }
    }
  }
  const sources = ALLOWED_SOURCES[action]
  const current = String(row.status)
  if (!sources) {
    return { ok: false, reason: `影像没有登记「${action}」这个动作` }
  }
  if (!sources.includes(current)) {
    if (isArchived(row)) {
      return {
        ok: false,
        reason: `影像 ${row['影像编号']} 已归档，归档只能按次序往前推，不允许跳级或改回待整理`,
      }
    }
    return {
      ok: false,
      reason: `状态只能按次序推进：待整理 → 已整理 → 已归档。当前为「${current}」，不能直接执行「${action}」`,
    }
  }
  if (action === '确认归档' && !hasStorageMedia(row)) {
    return {
      ok: false,
      reason: `影像 ${row['影像编号']} 未登记存储介质，不符合现行归档口径，按无效记录退回，补齐介质并重新整理后再归档`,
    }
  }
  return { ok: true, reason: '' }
}

// 字段修改校验：编号不可改；已归档全字段只读；归属规则同状态动作。
export function checkFieldUpdate(
  actor: PhotoActor,
  row: EntryRow,
  field: string,
): PermissionResult {
  if (field === '影像编号') {
    return { ok: false, reason: '影像编号是归档主键，列表页与详情页保持一致，不允许修改' }
  }
  if (field === '所属探方') {
    if (actor.role !== 'admin') {
      return { ok: false, reason: '影像的探方归属只能由管理员调整，资料员不能跨探方挪批次' }
    }
    const locked = archivedDeny(row)
    return locked ?? { ok: true, reason: '' }
  }
  if (!PHOTO_EDITABLE_FIELDS.includes(field)) {
    return { ok: false, reason: `字段「${field}」不在可整理范围内` }
  }
  return checkOwnership(actor, row)
}

export function actionTarget(action: string): string {
  if (action === '提交整理') return '已整理'
  if (action === '确认归档') return '已归档'
  if (action === '标记重拍') return '待重拍'
  return ''
}

// 某行对当前身份可执行的动作列表：列表页据此只放出有权限且符合次序的动作。
export function availableActions(actor: PhotoActor, row: EntryRow, actions: string[]): string[] {
  return actions.filter((action) => checkPhotoAction(actor, row, action).ok)
}

// 给动作按钮一个不可执行时的说明原因，方便页面直接提示，而不是让用户猜。
export function denyReason(actor: PhotoActor, row: EntryRow, action: string): string {
  return checkPhotoAction(actor, row, action).reason
}
