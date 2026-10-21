import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'packages/plugin-api/tsconfig.json'], { cwd: root, stdio: 'inherit' });
mkdirSync(path.join(root, '.cache/plugin-sdk'), { recursive: true });
// npm's JS entry avoids shell interpolation and Windows .cmd execution.
execFileSync(process.execPath, [process.env.npm_execpath, 'pack', './packages/plugin-api', '--pack-destination', '.cache/plugin-sdk', '--ignore-scripts'], { cwd: root, stdio: 'inherit' });
