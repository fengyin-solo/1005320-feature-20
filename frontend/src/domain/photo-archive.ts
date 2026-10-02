/**
 * 影像归档领域规则：权限按归属收口、归档状态只进不退、归档结论同步简报校核。
 * 页面组件不做业务判断，一律调用这里导出的函数（见 README 约定）。
 */
import {
  listBriefingRefs,
  listRows,
  resetBriefingRefs,
  saveBriefingRefs,
  saveRows,
} from '../data/local-store'
import type { EntryRow } from '../data/types'

const MODULE_KEY = 'photo'

export type PhotoRow = EntryRow

export type Role = '拍摄人' | '资料员' | '管理员'

export interface Identity {
  name: string
  role: Role
  /** 资料员负责的探方；拍摄人为本人所在探方；管理员为空表示全部探方 */
  trench: string
}

export interface Permission {
  allowed: boolean
  reason: string
}

/** 可切换的值班身份，用于演示归属收口；与影像 seed 里的拍摄人/探方对应。 */
export const IDENTITY_ROSTER: Identity[] = [
  { name: '王雪', role: '拍摄人', trench: 'T0101' },
  { name: '李柏', role: '拍摄人', trench: 'T0102' },
  { name: '张档', role: '资料员', trench: 'T0101' },
  { name: '陈档', role: '资料员', trench: 'T0102' },
  { name: '值班管理员', role: '管理员', trench: '' },
]

/**
 * 现行归档口径。老影像归档时已写下当时的口径版本，口径调整后老影像沿用历史结论、不重判。
 */
export const CURRENT_ARCHIVE_POLICY = {
  version: 'v2（2026归档口径）',
  rule: '待整理 → 已整理 → 已归档，按次序推进；没有存储介质的影像不许归档',
  requiresStorageMedia: true,
}

/** 归档主流程只能沿这个次序往前推。 */
export const PHOTO_STATUS_ORDER = ['待整理', '已整理', '已归档'] as const

export const PHOTO_ACTIONS = ['提交整理', '确认归档'] as const
export type PhotoAction = (typeof PHOTO_ACTIONS)[number]

const FIELD = {
  code: '影像编号',
  trench: '所属探方',
  photographer: '拍摄人',
  media: '存储介质',
  direction: '拍摄方向',
  policy: '归档口径',
  conclusion: '归档结论',
}

/** 列表页和详情页的影像编号统一走这个取值函数，两处口径一致，不允许各写各的。 */
export function photoCode(row: PhotoRow): string {
  return String(row[FIELD.code] ?? '').trim()
}

export function photoTrench(row: PhotoRow): string {
  return String(row[FIELD.trench] ?? '').trim()
}

function allow(): Permission {
  return { allowed: true, reason: '' }
}

function deny(reason: string): Permission {
  return { allowed: false, reason }
}

function nowText(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function storageMediaOf(row: PhotoRow): string {
  return String(row[FIELD.media] ?? '').trim()
}

/** 纯序列规则：归档只能按次序往前推，已归档不许跳级改回待整理。 */
export function guardForwardSequence(status: string, target: string): Permission {
  const from = PHOTO_STATUS_ORDER.indexOf(status as (typeof PHOTO_STATUS_ORDER)[number])
  const to = PHOTO_STATUS_ORDER.indexOf(target as (typeof PHOTO_STATUS_ORDER)[number])
  if (from < 0 || to < 0) {
    return deny(`影像状态「${status}」不在归档流程内，不能流转到「${target}」`)
  }
  if (to <= from) {
    return deny('归档只能按次序往前推（待整理 → 已整理 → 已归档），已归档的影像不许跳级改回待整理')
  }
  if (to !== from + 1) {
    return deny(`归档只能按次序往前推：当前「${status}」，需先走完「${PHOTO_STATUS_ORDER[from + 1]}」，不能跳到「${target}」`)
  }
  return allow()
}

function crossTrenchReason(identity: Identity, row: PhotoRow): string {
  return `跨探方改动已拦下：当前账号是 ${identity.trench} 的资料员，影像 ${photoCode(row)} 归属 ${photoTrench(row)}，跨探方的资料只能查看，不能整理或改动`
}

/**
 * 字段修改权限（拍摄方向等）：
 * - 归档后对拍摄人只读，只能查看不能改动；
 * - 本探方资料员可以整理自己负责的那批；跨探方改动一律拦下并说明原因；
 * - 归档锁定后，资料员也不能再改已归档资料。
 */
export function canEditPhoto(identity: Identity, row: PhotoRow): Permission {
  const code = photoCode(row)
  const status = String(row.status)

  if (identity.role === '管理员') {
    return allow()
  }

  if (status === '已归档') {
    if (identity.role === '拍摄人') {
      return deny(`影像 ${code} 已归档：归档后对拍摄人只读，只能查看，不能改动拍摄方向等任何内容`)
    }
    return deny(`影像 ${code} 已归档并锁定：归档只能按次序往前推，已归档资料不能再整理或改动`)
  }

  if (identity.role === '拍摄人') {
    const owner = String(row[FIELD.photographer] ?? '').trim()
    if (identity.name !== owner) {
      return deny(`影像 ${code} 的拍摄人是 ${owner}，拍摄人只能修改本人拍摄且尚未归档的影像`)
    }
    return allow()
  }

  if (identity.trench !== photoTrench(row)) {
    return deny(crossTrenchReason(identity, row))
  }
  return allow()
}

/** 状态流转权限：整理/归档由本探方资料员办理，叠加次序与介质校验。 */
export function describePhotoAdvance(
  action: string,
  row: PhotoRow,
  identity: Identity,
): Permission {
  const code = photoCode(row)
  const status = String(row.status)

  if (identity.role === '拍摄人') {
    return deny('影像的整理与归档由本探方资料员办理，拍摄人账号只能查看，不能改动状态')
  }
  if (identity.role === '资料员' && identity.trench !== photoTrench(row)) {
    return deny(crossTrenchReason(identity, row))
  }

  if (status === '已归档') {
    return deny(`影像 ${code} 已归档：归档只能按次序往前推，不许跳级改回待整理，也不能重新整理`)
  }

  if (action === '提交整理') {
    if (status === '已整理') {
      return deny(`影像 ${code} 已经是「已整理」，不用重复操作`)
    }
    if (status !== '待整理') {
      return deny(`影像 ${code} 当前为「${status}」，不能提交整理`)
    }
    return allow()
  }

  if (action === '确认归档') {
    const sequence = guardForwardSequence(status, '已归档')
    if (!sequence.allowed) {
      return deny(`影像 ${code}：${sequence.reason}`)
    }
    if (!storageMediaOf(row)) {
      return deny(`影像 ${code} 未登记存储介质：没有存储介质的影像不许归档，请先补登介质再办理归档`)
    }
    return allow()
  }

  return deny(`影像资料没有登记「${action}」这个动作`)
}

/** 页面渲染动作按钮：无权/不满足条件的按钮直接置灰并附上原因。 */
export function availablePhotoActions(
  row: PhotoRow,
  identity: Identity,
): { action: PhotoAction; allowed: boolean; reason: string }[] {
  return PHOTO_ACTIONS.map((action) => {
    const permission = describePhotoAdvance(action, row, identity)
    return { action, allowed: permission.allowed, reason: permission.reason }
  })
}

/** 不允许从补丁里改归属/状态/归档痕迹，归属收口不接受旁路。 */
const PROTECTED_KEYS = new Set([
  'id',
  'status',
  'pending',
  'abnormal',
  FIELD.code,
  FIELD.trench,
  FIELD.photographer,
  FIELD.policy,
  FIELD.conclusion,
  '归档人',
  '归档时间',
  '整理人',
  '整理时间',
  '最近修改人',
  '最近修改时间',
  '最近退回原因',
])

export interface SaveResult {
  ok: boolean
  message: string
}

export function listPhotos(filters: Record<string, string> = {}): PhotoRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  const rows = listRows(MODULE_KEY)
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function getPhoto(id: number): PhotoRow | undefined {
  return listRows(MODULE_KEY).find((row) => Number(row.id) === id)
}

/** 修改拍摄方向等字段；权限与归档锁全部在这里拦。 */
export function updatePhoto(
  id: number,
  patch: Record<string, string>,
  identity: Identity,
): SaveResult {
  const rows = listRows(MODULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的影像资料` }
  }
  const row = rows[index]
  const permission = canEditPhoto(identity, row)
  if (!permission.allowed) {
    return { ok: false, message: permission.reason }
  }

  const cleanPatch: Record<string, string> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (!PROTECTED_KEYS.has(key)) {
      cleanPatch[key] = String(value)
    }
  }

  const next = [...rows]
  next[index] = {
    ...row,
    ...cleanPatch,
    最近修改人: `${identity.name}（${identity.role}）`,
    最近修改时间: nowText(),
  }
  saveRows(MODULE_KEY, next)
  return { ok: true, message: `影像 ${photoCode(row)} 已保存修改，操作人已留痕` }
}

/** 推进归档状态：待整理 → 已整理 → 已归档，只进不退，归档必须有介质。 */
export function advancePhoto(id: number, action: string, identity: Identity): SaveResult {
  const rows = listRows(MODULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的影像资料` }
  }
  const row = rows[index]
  const permission = describePhotoAdvance(action, row, identity)
  if (!permission.allowed) {
    return { ok: false, message: permission.reason }
  }

  const updated: PhotoRow = { ...row }
  if (action === '提交整理') {
    updated.status = '已整理'
    updated.pending = true
    updated.整理人 = `${identity.name}（${identity.role}）`
    updated.整理时间 = nowText()
  } else {
    updated.status = '已归档'
    updated.pending = false
    updated.abnormal = false
    updated.归档人 = `${identity.name}（${identity.role}）`
    updated.归档时间 = nowText()
    updated[FIELD.policy] = CURRENT_ARCHIVE_POLICY.version
    updated[FIELD.conclusion] = `归档资料齐全（存储介质：${storageMediaOf(row)}），准予归档`
  }

  const next = [...rows]
  next[index] = updated
  saveRows(MODULE_KEY, next)
  return { ok: true, message: `影像 ${photoCode(row)} 已${action}，当前状态「${updated.status}」` }
}

/** 老影像：归档时写下的口径版本与现行口径不同，沿用历史结论、不按新口径重判。 */
export function isLegacyArchive(row: PhotoRow): boolean {
  const policy = String(row[FIELD.policy] ?? '').trim()
  return String(row.status) === '已归档' && policy !== '' && policy !== CURRENT_ARCHIVE_POLICY.version
}

export interface BriefingRef extends EntryRow {}

export function listArchivedBriefingRefs(): BriefingRef[] {
  return listBriefingRefs()
}

export interface SyncOutcome {
  synced: { code: string; conclusion: string; legacy: boolean }[]
  rejected: { code: string; reason: string }[]
  message: string
}

function syncOne(row: PhotoRow, refs: BriefingRef[]):
  | { status: 'rejected'; code: string; reason: string }
  | { status: 'synced'; code: string; conclusion: string; legacy: boolean } {
  const code = photoCode(row)

  if (String(row.status) !== '已归档') {
    return { status: 'rejected', code, reason: '影像尚未完成归档，不能进入简报待引用清单，直接退回' }
  }
  if (refs.some((ref) => String(ref[FIELD.code] ?? '') === code)) {
    return { status: 'rejected', code, reason: '归档结论已在简报校核待引用清单中，无需重复同步' }
  }

  const legacy = isLegacyArchive(row)
  if (legacy) {
    // 老影像沿用历史归档结论：哪怕按新口径缺介质，也不重新判定。
    return {
      status: 'synced',
      code,
      legacy: true,
      conclusion: String(row[FIELD.conclusion] ?? '历史归档结论'),
    }
  }

  if (!storageMediaOf(row)) {
    return { status: 'rejected', code, reason: '存储介质缺失，属无效记录，归档同步直接退回' }
  }

  return { status: 'synced', code, legacy: false, conclusion: String(row[FIELD.conclusion] ?? '') }
}

/** 归档处理完的结论同步到简报校核清单：有效归档多一条待引用项，无效记录直接退回。 */
export function syncArchivedPhotos(identity: Identity): SyncOutcome {
  if (identity.role === '拍摄人') {
    return {
      synced: [],
      rejected: [],
      message: '归档结论同步由资料员办理，拍摄人账号只能查看，已拦下本次操作',
    }
  }

  const refs = [...listBriefingRefs()]
  const outcome: SyncOutcome = { synced: [], rejected: [], message: '' }
  const photoRows = listRows(MODULE_KEY)
  const nextPhotos = [...photoRows]

  for (const row of photoRows) {
    const result = syncOne(row, refs)
    if (result.status === 'rejected') {
      // 重复同步属于幂等提示，不计入「退回」；未归档的也不逐条打扰，只有无效记录才真正退回。
      if (!result.reason.includes('无需重复同步') && !result.reason.includes('尚未完成归档')) {
        outcome.rejected.push({ code: result.code, reason: result.reason })
        const index = nextPhotos.findIndex((item) => photoCode(item) === result.code)
        if (index >= 0) {
          nextPhotos[index] = {
            ...nextPhotos[index],
            abnormal: true,
            最近退回原因: result.reason,
          }
        }
      }
      continue
    }

    const legacyNote = result.legacy ? '（历史归档结论沿用，归档口径调整后不重新判定）' : ''
    refs.push({
      id: refs.length + 1,
      status: '待引用',
      pending: true,
      abnormal: false,
      [FIELD.code]: result.code,
      [FIELD.trench]: photoTrench(row),
      [FIELD.photographer]: String(row[FIELD.photographer] ?? ''),
      [FIELD.conclusion]: `${result.conclusion}${legacyNote}`,
      [FIELD.policy]: String(row[FIELD.policy] ?? CURRENT_ARCHIVE_POLICY.version),
      同步时间: nowText(),
      引用时间: '',
    })
    outcome.synced.push({ code: result.code, conclusion: result.conclusion, legacy: Boolean(result.legacy) })
  }

  saveBriefingRefs(refs)
  if (nextPhotos.some((row, i) => row !== photoRows[i])) {
    saveRows(MODULE_KEY, nextPhotos)
  }

  const parts: string[] = []
  parts.push(
    outcome.synced.length > 0
      ? `已同步 ${outcome.synced.length} 条到简报校核待引用清单：${outcome.synced
          .map((item) => `${item.code}${item.legacy ? '（历史结论沿用）' : ''}`)
          .join('、')}`
      : '没有新的归档结论需要同步',
  )
  if (outcome.rejected.length > 0) {
    parts.push(
      `退回 ${outcome.rejected.length} 条：${outcome.rejected
        .map((item) => `${item.code}（${item.reason}）`)
        .join('、')}`,
    )
  }
  outcome.message = parts.join('；')
  return outcome
}

/** 详情页对单条影像做同步，同样的有效/无效口径。 */
export function syncSinglePhoto(id: number, identity: Identity): SyncOutcome & SaveResult {
  if (identity.role === '拍摄人') {
    const base = syncArchivedPhotos(identity)
    return { ...base, ok: false }
  }
  const row = getPhoto(id)
  if (!row) {
    return { ok: false, synced: [], rejected: [], message: `没有找到编号为 ${id} 的影像资料` }
  }
  const refs = listBriefingRefs()
  const result = syncOne(row, refs)
  if (result.status === 'rejected') {
    if (!result.reason.includes('无需重复同步')) {
      const rows = listRows(MODULE_KEY)
      const index = rows.findIndex((item) => Number(item.id) === id)
      if (index >= 0 && !result.reason.includes('尚未完成归档')) {
        const next = [...rows]
        next[index] = { ...next[index], abnormal: true, 最近退回原因: result.reason }
        saveRows(MODULE_KEY, next)
      }
    }
    return { ok: false, synced: [], rejected: [{ code: result.code, reason: result.reason }], message: `影像 ${result.code}：${result.reason}` }
  }

  const all = syncArchivedPhotos(identity)
  const target = all.synced.find((item) => item.code === result.code)
  return {
    ok: Boolean(target),
    synced: target ? [target] : [],
    rejected: all.rejected,
    message: target
      ? `影像 ${result.code} 的归档结论已同步到简报校核待引用清单${target.legacy ? '（历史归档结论沿用，不重判）' : ''}`
      : `影像 ${result.code}：归档结论此前已同步过，无需重复同步`,
  }
}

/** 简报编写人把待引用项正式引用进简报。 */
export function markBriefingRefCited(id: number): SaveResult {
  const refs = listBriefingRefs()
  const index = refs.findIndex((ref) => Number(ref.id) === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这条待引用项' }
  }
  if (refs[index].status === '已引用') {
    return { ok: false, message: '该待引用项已引用，不用重复操作' }
  }
  const next = [...refs]
  next[index] = { ...next[index], status: '已引用', pending: false, 引用时间: nowText() }
  saveBriefingRefs(next)
  return { ok: true, message: '待引用项已标记为已引用' }
}

export { resetBriefingRefs }
