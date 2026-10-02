import { BRIEFING_REF_SEED, SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'archaeology-field:entries'
// 影像归档口径改造：种子结构变了（新增所属探方/归档痕迹），版本号一并升级。
const STORAGE_VERSION = 2
const VERSION_KEY = 'archaeology-field:version'
const BRIEFING_REF_KEY = 'archaeology-field:briefing-refs'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

function writeVersion() {
  if (hasStorage()) {
    window.localStorage.setItem(VERSION_KEY, String(STORAGE_VERSION))
  }
}

function needsReseed(): boolean {
  if (!hasStorage()) {
    return false
  }
  return window.localStorage.getItem(VERSION_KEY) !== String(STORAGE_VERSION)
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (!hasStorage()) {
    return fallback
  }
  // 口径或种子结构变化时，旧缓存不沿用，直接按新版本重新播种。
  if (needsReseed()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(BRIEFING_REF_KEY, JSON.stringify(clone(BRIEFING_REF_SEED)))
    writeVersion()
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (hasStorage()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

// 简报校核「归档待引用清单」：由影像归档结论同步产生，与简报初稿数据分开存。
let refCache: EntryRow[] | null = null

export function listBriefingRefs(): EntryRow[] {
  if (refCache === null) {
    if (!hasStorage()) {
      refCache = clone(BRIEFING_REF_SEED)
    } else {
      const raw = window.localStorage.getItem(BRIEFING_REF_KEY)
      refCache = raw ? (JSON.parse(raw) as EntryRow[]) : clone(BRIEFING_REF_SEED)
    }
  }
  return refCache
}

export function saveBriefingRefs(rows: EntryRow[]): void {
  refCache = rows
  if (hasStorage()) {
    window.localStorage.setItem(BRIEFING_REF_KEY, JSON.stringify(rows))
  }
}

export function resetBriefingRefs(): EntryRow[] {
  const rows = clone(BRIEFING_REF_SEED)
  saveBriefingRefs(rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
