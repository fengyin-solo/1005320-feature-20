/**
 * 影像归档口径校验：直接跑在 node 上（esbuild 临时打包），不依赖浏览器。
 * 运行：npm run verify:photo
 */
import assert from 'node:assert'

import { resetRows, saveRows } from '../src/data/local-store'
import {
  CURRENT_ARCHIVE_POLICY,
  advancePhoto,
  canEditPhoto,
  getPhoto,
  guardForwardSequence,
  isLegacyArchive,
  listArchivedBriefingRefs,
  listPhotos,
  markBriefingRefCited,
  photoCode,
  resetBriefingRefs,
  syncArchivedPhotos,
  updatePhoto,
} from '../src/domain/photo-archive'

const photographerWang = { name: '王雪', role: '拍摄人' as const, trench: 'T0101' }
const photographerLi = { name: '李柏', role: '拍摄人' as const, trench: 'T0102' }
const clerkT0101 = { name: '张档', role: '资料员' as const, trench: 'T0101' }
const clerkT0102 = { name: '陈档', role: '资料员' as const, trench: 'T0102' }
const admin = { name: '值班管理员', role: '管理员' as const, trench: '' }

let passed = 0
function check(name: string, fn: () => void) {
  resetRows('photo')
  resetBriefingRefs()
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

function findByCode(code: string) {
  const row = listPhotos().find((item) => photoCode(item) === code)
  if (!row) {
    throw new Error(`种子缺少影像 ${code}`)
  }
  return row
}

console.log('影像归档口径校验开始')

// 1. 归档后对拍摄人只读，只能查看不能改动
check('归档后拍摄人改拍摄方向被拒，只能查看', () => {
  const archived = findByCode('PHOT-2026-0005') // 王雪拍摄、已归档
  const view = canEditPhoto(photographerWang, archived)
  assert.equal(view.allowed, false)
  assert.match(view.reason, /已归档/, `应说明归档只读，实际：${view.reason}`)
  const save = updatePhoto(Number(archived.id), { 拍摄方向: '由东向西' }, photographerWang)
  assert.equal(save.ok, false)
  assert.match(save.message, /只读/)
  assert.equal(getPhoto(Number(archived.id))?.['拍摄方向'], '由南向北')
})

// 2. 本探方资料员可以整理自己负责的那批
check('本探方资料员可整理本批影像', () => {
  const pending = findByCode('PHOT-2026-0001') // T0101 待整理
  const edit = canEditPhoto(clerkT0101, pending)
  assert.equal(edit.allowed, true, edit.reason)
  const result = advancePhoto(Number(pending.id), '提交整理', clerkT0101)
  assert.equal(result.ok, true)
  assert.equal(getPhoto(Number(pending.id))?.status, '已整理')
})

// 3. 跨探方的改动一律拦下并说明原因
check('跨探方资料员整理/修改一律拦下并说明原因', () => {
  const other = findByCode('PHOT-2026-0001') // T0101
  const edit = canEditPhoto(clerkT0102, other)
  assert.equal(edit.allowed, false)
  assert.match(edit.reason, /跨探方改动已拦下/)
  assert.match(edit.reason, /T0102/)
  assert.match(edit.reason, /T0101/)
  const move = advancePhoto(Number(other.id), '提交整理', clerkT0102)
  assert.equal(move.ok, false)
  assert.match(move.message, /跨探方/)
  assert.equal(getPhoto(Number(other.id))?.status, '待整理')
})

// 4. 归档只能按次序：待整理 → 已整理 → 已归档，不许跳级，已归档不许改回待整理
check('待整理不能跳过已整理直接归档', () => {
  const pending = findByCode('PHOT-2026-0001')
  const result = advancePhoto(Number(pending.id), '确认归档', clerkT0101)
  assert.equal(result.ok, false)
  assert.match(result.message, /按次序往前推/)
  assert.equal(getPhoto(Number(pending.id))?.status, '待整理')
})

check('已整理可以归档；已归档不许改回待整理（序列守卫）', () => {
  const organized = findByCode('PHOT-2026-0002') // 已整理、介质齐全
  const result = advancePhoto(Number(organized.id), '确认归档', clerkT0101)
  assert.equal(result.ok, true)
  assert.equal(getPhoto(Number(organized.id))?.status, '已归档')
  assert.equal(guardForwardSequence('已归档', '待整理').allowed, false)
  assert.equal(guardForwardSequence('已整理', '待整理').allowed, false)
  // 再点任何推进动作都应被挡
  const again = advancePhoto(Number(organized.id), '提交整理', clerkT0101)
  assert.equal(again.ok, false)
  assert.match(again.message, /已归档/)
})

// 5. 没有存储介质的影像不许归档
check('无存储介质：可提交整理，但确认归档被拒', () => {
  const noMedia = findByCode('PHOT-2026-0003') // T0102 缺介质
  assert.equal(canEditPhoto(clerkT0102, noMedia).allowed, true)
  const organized = advancePhoto(Number(noMedia.id), '提交整理', clerkT0102)
  assert.equal(organized.ok, true)
  const archive = advancePhoto(Number(noMedia.id), '确认归档', clerkT0102)
  assert.equal(archive.ok, false)
  assert.match(archive.message, /没有存储介质的影像不许归档/)
  assert.equal(getPhoto(Number(noMedia.id))?.status, '已整理')
})

// 6. 列表与详情影像编号一致（同源取值函数）
check('列表与详情编号取自同一 photoCode 取值函数', () => {
  for (const row of listPhotos()) {
    assert.equal(photoCode(row), String(row['影像编号'] ?? '').trim())
    assert.equal(photoCode(getPhoto(Number(row.id))!), photoCode(row))
  }
})

// 7. 口径改动后老影像沿用历史归档结论，不重判
check('老影像识别为历史归档；缺介质也不重判、仍可同步待引用', () => {
  const legacy = findByCode('PHOT-2025-0108')
  assert.equal(isLegacyArchive(legacy), true)
  assert.equal(String(legacy['归档口径']), 'v1（2025归档口径）')
  assert.notEqual(CURRENT_ARCHIVE_POLICY.version, String(legacy['归档口径']))
  assert.equal(String(legacy['存储介质']).trim(), '') // 老记录介质缺失

  const before = listArchivedBriefingRefs().length
  const outcome = syncArchivedPhotos(clerkT0102)
  // 种子里已含该老影像一条，幂等不重复；构造一条新口径下缺介质归档用于退回测试
  assert.equal(outcome.synced.some((item) => item.legacy), false)

  // 管理员把缺介质影像强行置为「已归档」（模拟脏数据/绕过），同步时必须退回，不进待引用
  const noMedia = findByCode('PHOT-2026-0003')
  const hacked = listPhotos().map((row) =>
    Number(row.id) === Number(noMedia.id)
      ? {
          ...row,
          status: '已归档',
          归档口径: CURRENT_ARCHIVE_POLICY.version,
          归档结论: '缺介质的无效归档',
        }
      : row,
  )
  // 直接落库验证同步退回逻辑
  saveRows('photo', hacked)
  resetBriefingRefs()
  const retry = syncArchivedPhotos(clerkT0102)
  const rejected = retry.rejected.find((item) => item.code === 'PHOT-2026-0003')
  assert.ok(rejected, '缺介质无效归档应被退回')
  assert.match(rejected!.reason, /存储介质缺失|无效记录.*退回/)
  const refs = listArchivedBriefingRefs()
  assert.equal(
    refs.some((ref) => ref['影像编号'] === 'PHOT-2026-0003'),
    false,
    '无效记录不得进入待引用清单',
  )
  // 老影像缺介质但沿用历史结论：应在清单内（种子已有），且不产生退回
  assert.ok(refs.some((ref) => ref['影像编号'] === 'PHOT-2025-0108'))
  assert.equal(retry.rejected.some((item) => item.code === 'PHOT-2025-0108'), false)
  assert.ok(before >= 1)
})

// 8. 归档结论同步到简报校核：有效归档多一条待引用
check('有效归档同步后简报待引用清单新增一条，可标记已引用', () => {
  const organized = findByCode('PHOT-2026-0002') // 已整理、介质齐全
  const archive = advancePhoto(Number(organized.id), '确认归档', clerkT0101)
  assert.equal(archive.ok, true)

  resetBriefingRefs()
  const outcome = syncArchivedPhotos(clerkT0101)
  const synced = outcome.synced.find((item) => item.code === 'PHOT-2026-0002')
  assert.ok(synced, '应同步有效归档结论')
  const refs = listArchivedBriefingRefs()
  const target = refs.find((ref) => ref['影像编号'] === 'PHOT-2026-0002')
  assert.ok(target, '待引用清单应包含该影像')
  assert.equal(target!.status, '待引用')
  const cited = markBriefingRefCited(Number(target!.id))
  assert.equal(cited.ok, true)
  assert.equal(listArchivedBriefingRefs().find((ref) => ref.id === target!.id)?.status, '已引用')

  // 重复同步幂等，不多条目
  const again = syncArchivedPhotos(clerkT0101)
  assert.equal(again.synced.some((item) => item.code === 'PHOT-2026-0002'), false)
})

// 9. 拍摄人不能办理整理/归档；非本人拍摄的未归档影像也不能改
check('拍摄人不能办理状态流转，也不能改别人拍的影像', () => {
  const otherShot = findByCode('PHOT-2026-0006') // 李柏拍、在 T0101
  const move = advancePhoto(Number(otherShot.id), '提交整理', photographerWang)
  assert.equal(move.ok, false)
  assert.match(move.message, /拍摄人账号只能查看/)
  const edit = updatePhoto(Number(otherShot.id), { 拍摄方向: '仰视' }, photographerWang)
  assert.equal(edit.ok, false)
  // 本人拍摄且未归档可以改
  const own = findByCode('PHOT-2026-0001')
  const ownEdit = updatePhoto(Number(own.id), { 拍摄方向: '由东向西' }, photographerWang)
  assert.equal(ownEdit.ok, true)
  assert.equal(getPhoto(Number(own.id))?.['拍摄方向'], '由东向西')
})

// 10. 同步入口拍摄人不可用
check('拍摄人不能执行归档结论同步', () => {
  const outcome = syncArchivedPhotos(photographerLi)
  assert.equal(outcome.synced.length, 0)
  assert.match(outcome.message, /拍摄人/)
})

// 管理员也不能越过介质规则与次序规则
check('管理员同样受介质校验与次序约束', () => {
  const noMedia = findByCode('PHOT-2026-0003')
  // 待整理直接归档：先拦次序
  const skip = advancePhoto(Number(noMedia.id), '确认归档', admin)
  assert.equal(skip.ok, false)
  assert.match(skip.message, /按次序往前推/)
  // 走完整理再归档：介质校验仍然拦
  const organized = advancePhoto(Number(noMedia.id), '提交整理', admin)
  assert.equal(organized.ok, true)
  const direct = advancePhoto(Number(noMedia.id), '确认归档', admin)
  assert.equal(direct.ok, false)
  assert.match(direct.message, /存储介质/)
})

resetRows('photo')
resetBriefingRefs()
console.log(`\n全部 ${passed} 组口径校验通过`)
