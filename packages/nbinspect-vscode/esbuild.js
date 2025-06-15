const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  // Bundle extension (Node.js context)
  const extensionCtx = await esbuild.context({
    entryPoints: ['src/extension.js'],
    bundle: true,
    outdir: 'dist',
    format: 'cjs',
    minify: production,
    sourcemap: watch,
    sourcesContent: false,
    platform: 'node',
    external: ['vscode', 'crypto'],
    logLevel: 'warning',
    plugins: [esbuildProblemMatcherPlugin]
  });

  // Bundle renderer (browser context)
  const rendererCtx = await esbuild.context({
    entryPoints: ['src/renderer.js'],
    bundle: true,
    outfile: 'dist/renderer.js',
    format: 'esm',
    minify: production,
    sourcemap: watch,
    sourcesContent: false,
    platform: 'browser',
    logLevel: 'warning',
    plugins: [esbuildProblemMatcherPlugin]
  });

  if (watch) {
    await Promise.all([
      extensionCtx.watch(),
      rendererCtx.watch()
    ]);
  } else {
    await Promise.all([
      extensionCtx.rebuild(),
      rendererCtx.rebuild()
    ]);
    await Promise.all([
      extensionCtx.dispose(),
      rendererCtx.dispose()
    ]);
  }
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',

  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd(result => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        if (location == null) return;
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log('[watch] build finished');
    });
  }
};

main().catch(e => {
  console.error(e);
  process.exit(1);
});
