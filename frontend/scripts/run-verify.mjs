// 用 esbuild 的 JS API 在 node 下临时打包并执行校验脚本，绕开跨平台二进制软链问题。
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { rmSync } from 'node:fs'

const outfile = 'node_modules/.cache/verify-photo-rules.mjs'

await build({
  entryPoints: ['scripts/verify-photo-rules.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'info',
})

try {
  await import(pathToFileURL(outfile).href)
} finally {
  rmSync(outfile, { force: true })
}
