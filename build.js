import { build } from 'esbuild'

try {
  await build({
    entryPoints: ['./src/main.ts'],
    bundle: true,
    outdir: './dist/',
    sourcemap: true,
    minify: true,
    conditions: ['worker', 'browser'],
    outExtension: { '.js': '.mjs' },
    format: 'esm',
    target: 'esnext'
  })
} catch {
  process.exitCode = 1
}
