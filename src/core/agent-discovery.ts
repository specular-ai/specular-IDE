import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { inside } from './workspace';
import type { AgentId, AgentCheckResult } from '../shared/types';

export const agentDefinitions = {
  codex: { command: 'codex', version: /^(?:codex-cli|codex)\s+\d+\.\d+[^\r\n]*$/im },
  claude: { command: 'claude', version: /^\d+\.\d+[^\r\n]*\(Claude Code\)[^\r\n]*$/im },
} satisfies Record<AgentId, { command: string; version: RegExp }>;

export interface DiscoveryOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  projectRoot?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function stopProcess(pid: number): Promise<boolean> {
  if (process.platform === 'win32') {
    return new Promise<boolean>(resolve => execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/pid', String(pid), '/t', '/f'], { windowsHide: true, timeout: 2000 }, error => resolve(!error)));
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* Already exited. */ }
    return true;
  }
}

// Only fixed --version arguments cross this boundary; never accept a command line.
export function checkVersion(file: string, options: DiscoveryOptions): Promise<{ status: AgentCheckResult['status']; output: string; message: string }> {
  return new Promise(resolve => {
    const batch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(file);
    // cmd expands these even inside quotes. Reject instead of attempting shell escaping.
    if (batch && /[%!^"\r\n]/.test(file)) {
      resolve({ status: 'invalid', output: '', message: 'This launcher path contains unsupported shell characters. Choose a native executable or move the launcher.' }); return;
    }
    if (options.signal?.aborted) { resolve({ status: 'failed', output: '', message: 'Version check cancelled.' }); return; }
    let child: ReturnType<typeof spawn> & Pick<ChildProcessWithoutNullStreams, 'stdout' | 'stderr'>;
    try { child = spawn(batch ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe') : file,
      batch ? ['/d', '/s', '/c', `""${file}" --version"`] : ['--version'], {
        cwd: options.cwd, env: options.env ?? process.env, windowsHide: true,
        windowsVerbatimArguments: batch, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
      }); } catch {
      resolve({ status: 'failed', output: '', message: 'Could not launch this file. Check its permissions and required runtime.' }); return;
    }
    let output = ''; let bytes = 0; let finished = false;
    const finish = async (status: AgentCheckResult['status'], message: string, kill = false) => {
      if (finished) return;
      finished = true; clearTimeout(timer); options.signal?.removeEventListener('abort', cancel);
      if (kill && child.pid) {
        const stopped = await stopProcess(child.pid); child.kill();
        if (!stopped) message += ' Windows could not confirm launcher process-tree cleanup.';
      }
      child.stdout.destroy(); child.stderr.destroy();
      resolve({ status, output: output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim(), message });
    };
    const cancel = () => { void finish('failed', 'Version check cancelled.', true); };
    const timer = setTimeout(() => { void finish('timeout', 'Version check timed out. Verify the installation and try again.', true); }, options.timeoutMs ?? 5000);
    options.signal?.addEventListener('abort', cancel, { once: true });
    const collect = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 16_384) { void finish('failed', 'Version check produced too much output.', true); return; }
      output += chunk.toString('utf8');
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('error', () => { void finish('failed', 'Could not launch this file. Check its permissions and required runtime.'); });
    child.once('close', code => { void finish(code === 0 ? 'detected' : 'failed', code === 0 ? '' : `Version check failed (exit ${code ?? 'unknown'}). Repair the installation or choose another path.`); });
  });
}

export async function discoverAgent(agent: AgentId, explicitPath: string, options: DiscoveryOptions): Promise<AgentCheckResult> {
  const result = (status: AgentCheckResult['status'], message: string, file?: string): AgentCheckResult => ({ agent, status, message, path: file });
  if (!Object.hasOwn(agentDefinitions, agent)) return result('invalid', 'Unknown agent.');
  if (typeof explicitPath !== 'string' || explicitPath.length > 4096 || /[\x00-\x1f"]/.test(explicitPath)) return result('invalid', 'Enter an absolute executable path without quotes or arguments.');
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat'] : [''];
  let file: string | undefined;
  try {
    if (explicitPath) {
      if (!path.isAbsolute(explicitPath) || explicitPath !== explicitPath.trim()) return result('invalid', 'Enter an absolute executable path without quotes or arguments.');
      if (process.platform === 'win32' && !extensions.includes(path.extname(explicitPath).toLowerCase())) return result('invalid', 'Choose an .exe, .cmd, or .bat file. For npm installations use the .cmd launcher, not .ps1.');
      file = explicitPath;
      if (!(await stat(file)).isFile()) return result('invalid', 'The selected path is not a file.', file);
    } else {
      const env = options.env ?? process.env;
      const searchPath = Object.entries(env).find(([key, value]) => key.toLowerCase() === 'path' && typeof value === 'string')?.[1] ?? '';
      for (const entry of searchPath.split(path.delimiter)) {
        const directory = entry.replace(/^"(.*)"$/, '$1');
        // Do not implicitly search the project, current directory, or relative PATH entries.
        if (!path.isAbsolute(directory)) continue;
        for (const extension of extensions) {
          const candidate = path.join(directory, agentDefinitions[agent].command + extension);
          try {
            const canonical = await realpath(candidate);
            if (options.projectRoot && inside(options.projectRoot, canonical)) continue;
            if ((await stat(candidate)).isFile()) { file = candidate; break; }
          } catch { /* Continue PATH discovery. */ }
        }
        if (file) break;
      }
      if (!file) return result('missing', 'Not found on PATH. Install the agent manually, restart Specular after changing PATH, or choose its executable.');
    }
    const checked = await checkVersion(file, options);
    if (checked.status !== 'detected') return result(checked.status, checked.message, file);
    const version = checked.output.match(agentDefinitions[agent].version)?.[0];
    if (!version) return result('failed', 'The command exited successfully but did not report a recognized agent version. Check that this is the correct executable.', file);
    return { ...result('detected', 'CLI detected. Authentication and protocol compatibility have not been checked.', file), version };
  } catch { return result(explicitPath ? 'invalid' : 'failed', 'The executable is missing or cannot be accessed. Choose an installed agent executable.', file); }
}
