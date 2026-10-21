import { execFile } from 'node:child_process';
import { copyFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';

// ConPTY needs ENABLE_VIRTUAL_TERMINAL_INPUT to pass paste markers through.
// Node's raw console input does not enable it, so use a native console fixture.
export async function createTerminalAgent(directory: string, kind: 'codex' | 'claude') {
  const source = path.join(directory, 'terminal-agent.cs');
  await copyFile('tests/helpers/terminal-agent.cs', source);
  const launcher = path.join(directory, kind + ' terminal.exe');
  await promisify(execFile)(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-Command', 'Add-Type -Path $env:SPECULAR_FIXTURE_SOURCE -OutputAssembly $env:SPECULAR_FIXTURE_EXE -OutputType ConsoleApplication -ReferencedAssemblies System.Web.Extensions'],
    { windowsHide: true, env: { ...process.env, SPECULAR_FIXTURE_SOURCE: source, SPECULAR_FIXTURE_EXE: launcher } });
  return { launcher, state: path.join(directory, kind + '-input.json'), disable: path.join(directory, kind + '-disable-paste'), exit: path.join(directory, kind + '-exit') };
}
