const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.js'],
    bundle: true,
    outdir: 'dist',
    format: 'cjs',
    minify: production,
    sourcemap: watch,
    sourcesContent: false,
    platform: 'node',
    external: ['vscode', 'lodash', 'crypto'],
    logLevel: 'warning',
    // target: 'es2020',
    plugins: [
      /* add to the end of plugins array */
      esbuildProblemMatcherPlugin,
      copyPlugin
    ]
  });
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

// Simple copy plugin
const copyPlugin = {
  name: 'copy',
  setup(build) {
    build.onEnd(() => {
      fs.copyFileSync(
        path.join('src', 'renderer.js'),
        path.join('dist', 'renderer.js')
      )
      console.log('Copied renderer.js to dist/')
    })
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
