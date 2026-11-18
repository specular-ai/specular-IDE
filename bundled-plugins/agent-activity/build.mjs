import { build } from 'esbuild';
await build({ entryPoints: ['src/index.ts'], outfile: 'dist/index.js', bundle: true, platform: 'browser', format: 'esm', target: 'es2022' });
