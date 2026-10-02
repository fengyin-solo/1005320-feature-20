import type { PhotoCitation } from './types'

// 归档结论同步到简报校核的待引用清单：只有归档有效的影像才会进入；
// 介质缺失等无效记录在归档环节直接退回，不生成条目。
const STORAGE_KEY = 'archaeology-field:photo-citations:v1'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 首次播种：与影像种子里 v1 历史已归档的两条对应，它们在老口径下已归档且归档结论有效。
const SEED_CITATIONS: PhotoCitation[] = [
  {
    id: 1,
    photoId: 5,
    影像编号: 'PHOT-0005',
    所属探方: 'T0101',
    拍摄对象: '②层整体揭露面',
    拍摄人: '周摄',
    归档时间: '2026-09-08',
    归档口径: 'v1（历史归档口径）',
    status: '待引用',
    引用简报: '',
  },
  {
    id: 2,
    photoId: 6,
    影像编号: 'PHOT-0006',
    所属探方: 'T0102',
    拍摄对象: 'H5 灰坑近景',
    拍摄人: '吴摄',
    归档时间: '2026-09-04',
    归档口径: 'v1（历史归档口径）',
    status: '待引用',
    引用简报: '',
  },
]

function readStorage(): PhotoCitation[] {
  const fallback = clone(SEED_CITATIONS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as PhotoCitation[]
    return Array.isArray(parsed) ? parsed : fallback
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: PhotoCitation[] | null = null

export function listCitations(): PhotoCitation[] {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function pendingCitations(): PhotoCitation[] {
  return listCitations().filter((item) => item.status === '待引用')
}

function persist(rows: PhotoCitation[]): PhotoCitation[] {
  cache = rows
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
  }
  return rows
}

// 归档成功后调用：同一条影像只允许在清单里出现一条，重复归档同步不产生重复待引用项。
export function addPhotoCitation(
  input: Omit<PhotoCitation, 'id' | 'status' | '引用简报'>,
): PhotoCitation {
  const rows = listCitations()
  const existing = rows.find((item) => item.photoId === input.photoId)
  if (existing) {
    return existing
  }
  const nextId = rows.reduce((max, item) => Math.max(max, item.id), 0) + 1
  const created: PhotoCitation = { ...input, id: nextId, status: '待引用', 引用简报: '' }
  persist([...rows, created])
  return created
}

export function markCitationUsed(id: number, briefingNo: string): PhotoCitation | null {
  const rows = listCitations()
  const index = rows.findIndex((item) => item.id === id)
  if (index < 0) {
    return null
  }
  const updated: PhotoCitation = {
    ...rows[index],
    status: '已引用',
    引用简报: briefingNo || '手工标记',
  }
  const next = [...rows]
  next[index] = updated
  persist(next)
  return updated
}

export function citationStorageKey(): string {
  return STORAGE_KEY
}
