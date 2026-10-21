import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Terminals } from '../src/core/terminals';
import type { TerminalEvent } from '../src/shared/types';
async function setup() {
  const base = path.resolve('.cache/terminal-tests'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'project & ñ ')); const events: TerminalEvent[] = [];
  const manager = new Terminals(event => { events.push(event); if (event.type === 'data') manager.acknowledge(event.id, event.data.length); }, root);
  return { root, events, manager };
}
async function until(check: () => Promise<boolean> | boolean) { for (let i = 0; i < 150; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 100)); } assert.fail('Terminal condition timed out.'); }
test('real Windows PTY runs PowerShell in the project, supports input/resize and closes its running child', async () => {
  const { root, events, manager } = await setup();
  try {
    const info = await manager.open('powershell', root); manager.attach(info.id); manager.resize(info.id, 120, 35);
    await until(() => events.some(e => e.type === 'data'));
    manager.input(info.id, "[IO.File]::WriteAllText((Join-Path (Get-Location) 'proof.md'), 'terminal-ran'); [IO.File]::WriteAllText((Join-Path (Get-Location) 'pid.txt'), [string]$PID)\r");
    await until(async () => (await readFile(path.join(root, 'proof.md'), 'utf8').catch(() => '')) === 'terminal-ran');
    await until(async () => !!(await readFile(path.join(root, 'pid.txt'), 'utf8').catch(() => '')));
    const pid = Number(await readFile(path.join(root, 'pid.txt'), 'utf8'));
    manager.input(info.id, 'Start-Sleep -Seconds 60\r');
    assert.equal(await manager.close(info.id), true); assert.throws(() => process.kill(pid, 0)); assert.equal(manager.list().length, 0);
  } finally { await manager.shutdown(); }
});
test('native batch agent launch preserves an executable path with spaces and ampersands; validates requests and keeps exit state', async () => {
  const { root, events, manager } = await setup(); const agent = path.join(root, 'agent & launcher.cmd'); const project = path.join(root, 'nested project'); await mkdir(project);
  await writeFile(agent, '@echo off\r\nif "%~1"=="--version" (\r\necho codex-cli 0.154.0\r\nexit /b 0\r\n)\r\necho NATIVE-AGENT-READY\r\nset /p input=\r\necho %input%> agent-command.txt\r\n');
  try {
    await assert.rejects(manager.open('unknown', project)); await assert.rejects(manager.open('cmd', path.join(root, 'missing')));
    const info = await manager.open('codex', project, agent); manager.attach(info.id);
    await until(() => events.some(e => e.type === 'data' && e.data.includes('NATIVE-AGENT-READY')));
    manager.input(info.id, '/native-command\r');
    await until(() => manager.list()[0]?.status === 'exited');
    assert.equal((await readFile(path.join(project, 'agent-command.txt'), 'utf8')).trim(), '/native-command');
    manager.resize(info.id, -1, Infinity); manager.input('unknown', 'ignored'); assert.equal(await manager.close(info.id), true);
  } finally { await manager.shutdown(); }
});
