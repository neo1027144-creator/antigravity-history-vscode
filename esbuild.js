// @ts-check
const esbuild = require('esbuild');
const { cpSync, existsSync, mkdirSync } = require('fs');
const { join } = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** Copy webview assets (HTML/CSS/JS) to dist/ */
function copyWebviewAssets() {
  const src = join(__dirname, 'src', 'webview', 'assets');
  const dest = join(__dirname, 'dist', 'webview');
  if (existsSync(src)) {
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });
  }
}

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'info',
  });

  copyWebviewAssets();

  if (watch) {
    await ctx.watch();
    console.log('[watch] Build started...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
