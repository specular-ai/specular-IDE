import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';

await mkdir('dist/renderer', { recursive: true });
await mkdir('dist/bundled-plugins/relationships/dist', { recursive: true });
await Promise.all([
  build({ entryPoints: ['bundled-plugins/relationships/src/index.ts'], outfile: 'dist/bundled-plugins/relationships/dist/index.js', bundle: true, platform: 'browser', format: 'esm', target: 'es2022' }),
  copyFile('bundled-plugins/relationships/package.json', 'dist/bundled-plugins/relationships/package.json'),
  copyFile('bundled-plugins/relationships/specular-plugin.json', 'dist/bundled-plugins/relationships/specular-plugin.json'),
  build({ entryPoints: ['src/preload/plugin.ts'], outfile: 'dist/plugin-preload.cjs', bundle: true,
    platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ entryPoints: ['src/main/index.ts'], outfile: 'dist/main.cjs', bundle: true,
    platform: 'node', format: 'cjs', target: 'node22', external: ['electron', 'node-pty'], sourcemap: true }),
  build({ entryPoints: ['src/mcp/specular-mcp.ts'], outfile: 'dist/specular-mcp.cjs', bundle: true,
    platform: 'node', format: 'cjs', target: 'node22' }),
  build({ entryPoints: ['src/workers/agent-tools.ts'], outfile: 'dist/agent-tools-worker.cjs', bundle: true,
    platform: 'node', format: 'cjs', target: 'node22', sourcemap: true }),
  build({ entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload.cjs', bundle: true,
    platform: 'node', format: 'cjs', external: ['electron'], sourcemap: true }),
  build({ entryPoints: ['src/workers/index.ts'], outfile: 'dist/renderer/analysis-worker.js', bundle: true,
    platform: 'browser', format: 'esm', conditions: ['worker'], target: 'es2022', sourcemap: true }),
  build({ entryPoints: ['src/renderer/index.ts'], outdir: 'dist/renderer', bundle: true,
    platform: 'browser', format: 'esm', splitting: true, target: 'es2022', sourcemap: true,
    loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' } }),
  copyFile('src/renderer/index.html', 'dist/renderer/index.html'),
  copyFile('assets/specular-logo.svg', 'dist/renderer/specular-logo.svg'),
]);
console.log('Built Specular.');
