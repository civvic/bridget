import * as esbuild from 'esbuild'

await esbuild.build({
  entryPoints: ['nbs/js/bridge.js'],
  bundle: true,
  outdir: 'bridget/js',
  format: 'esm',
})
