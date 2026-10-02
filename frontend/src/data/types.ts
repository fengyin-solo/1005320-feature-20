/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 影像归档结论同步给简报校核的待引用项：归档有效才会生成，介质缺失被退回的不进清单。
export type PhotoCitation = {
  id: number
  photoId: number
  影像编号: string
  所属探方: string
  拍摄对象: string
  拍摄人: string
  归档时间: string
  归档口径: string
  status: '待引用' | '已引用'
  引用简报: string
}
