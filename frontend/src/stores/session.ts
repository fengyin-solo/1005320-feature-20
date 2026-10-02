import { defineStore } from 'pinia'

import { IDENTITY_ROSTER, type Identity } from '@/domain/photo-archive'

// 默认以拍摄人身份进入，最能体现「归档后对拍摄人只读」；页面上可切换身份验证各类拦截。
const DEFAULT_IDENTITY: Identity = IDENTITY_ROSTER[0]

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: DEFAULT_IDENTITY.name,
    shiftLabel: '白班 08:00-20:00',
    scope: '考古发掘现场记录与出土物整理工作台',
    identity: { ...DEFAULT_IDENTITY } as Identity,
    identityRoster: IDENTITY_ROSTER as Identity[],
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    switchIdentity(identity: Identity) {
      this.identity = { ...identity }
      this.operator = identity.name
    },
  },
})
