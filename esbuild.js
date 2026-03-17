// @ts-check
const esbuild = require('esbuild');
const { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs');
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

/**
 * Post-build: obfuscate the bundled JS for production releases.
 * This makes reverse-engineering the LS discovery and API logic very difficult.
 */
function obfuscateBundle() {
  const JavaScriptObfuscator = require('javascript-obfuscator');
  const bundlePath = join(__dirname, 'dist', 'extension.js');
  const code = readFileSync(bundlePath, 'utf-8');

  console.log('[obfuscate] Starting deep obfuscation...');
  const result = JavaScriptObfuscator.obfuscate(code, {
    // --- Control flow (DISABLED - breaks async/await in Node.js) ---
    controlFlowFlattening: false,
    deadCodeInjection: false,

    // --- String protection (CORE - hides API paths, method names) ---
    stringArray: true,
    stringArrayEncoding: ['rc4'],
    stringArrayThreshold: 0.75,
    splitStrings: false,

    // --- Identifier mangling ---
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,  // keep module.exports intact

    // --- Anti-debug (DISABLED - crashes in VS Code) ---
    selfDefending: false,
    debugProtection: false,

    // --- Misc ---
    transformObjectKeys: false,  // can break dynamic key access
    unicodeEscapeSequence: false,
    compact: true,
    simplify: true,

    // --- Target ---
    target: 'node',
  });

  writeFileSync(bundlePath, result.getObfuscatedCode());
  console.log('[obfuscate] Done. Bundle protected.');
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
    legalComments: production ? 'none' : 'inline',
    drop: production ? ['console', 'debugger'] : [],
  });

  copyWebviewAssets();

  if (watch) {
    await ctx.watch();
    console.log('[watch] Build started...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();

    // Production: apply deep obfuscation after esbuild
    if (production) {
      obfuscateBundle();
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

