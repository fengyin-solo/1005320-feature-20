import { defineStore } from 'pinia'

import type { PhotoActor } from '@/domain/photo-policy'

// 影像归档权限按身份收口：
// - 摄影师：只能看、只能改自己未归档影像的登记内容，归档后只读
// - 资料员：只能整理自己所属探方的那批，跨探方一律拦下
// - 管理员：全探方可操作，但归档锁定与状态次序同样不能突破
export type SessionRole = PhotoActor['role']

type IdentityPreset = {
  label: string
  operator: string
  role: SessionRole
  trench: string
}

export const IDENTITY_PRESETS: IdentityPreset[] = [
  { label: '管理员（全探方）', operator: '值班管理员', role: 'admin', trench: '' },
  { label: '资料员 · T0101', operator: '李资料', role: 'clerk', trench: 'T0101' },
  { label: '资料员 · T0102', operator: '陈资料', role: 'clerk', trench: 'T0102' },
  { label: '摄影师 · 周摄', operator: '周摄', role: 'photographer', trench: '' },
]

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    role: 'admin' as SessionRole,
    trench: '',
    shiftLabel: '白班 08:00-20:00',
    scope: '考古发掘现场记录与出土物整理工作台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    // 影像归档域使用的操作者身份
    photoActor(state): PhotoActor {
      return { name: state.operator, role: state.role, trench: state.trench }
    },
    roleLabel(state): string {
      if (state.role === 'admin') return '管理员'
      if (state.role === 'clerk') return `资料员（${state.trench || '未分配探方'}）`
      return '摄影师'
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    switchIdentity(preset: IdentityPreset) {
      this.operator = preset.operator
      this.role = preset.role
      this.trench = preset.trench
    },
  },
})
