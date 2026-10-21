import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { realpath, readdir } from 'node:fs/promises';
import path from 'node:path';
import * as pty from 'node-pty';
import { discoverAgent } from './agent-discovery';
import type { TerminalEvent, TerminalInfo, TerminalKind } from '../shared/types';
import { encodeTerminalBrief } from '../shared/terminal-brief';

type Session = { info: TerminalInfo; process: pty.IPty; dispose: () => void; attached: boolean; pending: string[]; outstanding: number; paused: boolean; exited: Promise<void>; close?: Promise<boolean> };
export class Terminals {
  private sessions = new Map<string, Session>();
  private launches = new Set<Promise<TerminalInfo>>();
  private shuttingDown = false;
  constructor(private readonly event: (event: TerminalEvent) => void, private readonly discoveryDirectory: string) {}
  list() { return [...this.sessions.values()].map(s => ({ ...s.info })); }
  open(kind: unknown, root: string, executable: unknown = ''): Promise<TerminalInfo> {
    if (!['powershell', 'cmd', 'codex', 'claude'].includes(String(kind)) || typeof executable !== 'string' || executable.length > 4096) return Promise.reject(new Error('Choose PowerShell, Command Prompt, Codex, or Claude.'));
    if (this.shuttingDown || this.sessions.size + this.launches.size >= 6) return Promise.reject(new Error('Close a terminal first. Up to six terminal tabs can be open.'));
    const launch = this.start(kind as TerminalKind, root, executable);
    this.launches.add(launch); void launch.finally(() => this.launches.delete(launch)).catch(() => {}); return launch;
  }
  private async start(kind: TerminalKind, root: string, explicit: string) {
    const cwd = await realpath(root); await readdir(cwd);
    const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
    let file = path.join(system, kind === 'powershell' ? 'WindowsPowerShell/v1.0/powershell.exe' : 'cmd.exe');
    let args: string[] | string = kind === 'powershell' ? ['-NoLogo', '-NoProfile'] : ['/d'];
    if (kind === 'codex' || kind === 'claude') {
      const agent = await discoverAgent(kind, explicit, { cwd: this.discoveryDirectory, projectRoot: cwd });
      if (agent.status !== 'detected' || !agent.path) throw new Error('Agent not available. Check its installation/path in Agent setup, then retry.');
      if (/\.(cmd|bat)$/i.test(agent.path)) {
        if (/[%!^"\r\n]/.test(agent.path)) throw new Error('This launcher path contains unsupported shell characters. Choose a native executable.');
        file = path.join(system, 'cmd.exe'); args = `/d /s /c ""${agent.path}""`;
      } else { file = agent.path; args = []; }
    }
    if (this.shuttingDown) throw new Error('Specular is closing.');
    const env: NodeJS.ProcessEnv = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
    delete env.ELECTRON_RUN_AS_NODE;
    const processTerminal = pty.spawn(file, args, { cwd, env, cols: 100, rows: 28, name: 'xterm-256color', useConpty: true });
    const info: TerminalInfo = { id: randomUUID(), kind, root: cwd, status: 'running' };
    let resolveExit!: () => void;
    let disposed = false;
    const dispose = () => { if (disposed) return; disposed = true; try { processTerminal.kill(); } catch { /* Process already exited. */ } };
    const session: Session = { info, process: processTerminal, dispose, attached: false, pending: [], outstanding: 0, paused: false, exited: new Promise(resolve => { resolveExit = resolve; }) };
    this.sessions.set(info.id, session);
    processTerminal.onData(data => {
      if (!this.sessions.has(info.id)) return;
      session.outstanding += data.length;
      if (!session.paused && session.outstanding > 262_144) { session.paused = true; processTerminal.pause(); }
      if (session.attached) this.event({ type: 'data', id: info.id, data }); else session.pending.push(data);
    });
    processTerminal.onExit(({ exitCode }) => {
      info.status = 'exited'; info.exitCode = exitCode; dispose(); resolveExit();
      if (this.sessions.has(info.id)) this.event({ type: 'state', terminal: { ...info } });
    });
    return { ...info };
  }
  attach(id: string) { const s = this.sessions.get(id); if (!s || s.attached) return; s.attached = true; for (const data of s.pending) this.event({ type: 'data', id, data }); s.pending = []; this.event({ type: 'state', terminal: { ...s.info } }); }
  acknowledge(id: string, length: unknown) {
    const s = this.sessions.get(id); if (!s || typeof length !== 'number' || !Number.isInteger(length) || length < 0 || length > s.outstanding) return;
    s.outstanding -= length; if (s.paused && s.outstanding < 65_536) { s.paused = false; s.process.resume(); }
  }
  input(id: string, data: unknown) { const s = this.sessions.get(id); if (s?.info.status === 'running' && typeof data === 'string' && data.length <= 65_536) { try { s.process.write(data); } catch { /* Exit can race input. */ } } }
  insertBrief(id: unknown, root: string, text: unknown): { ok: boolean; message?: string } {
    const s = typeof id === 'string' ? this.sessions.get(id) : undefined;
    if (this.shuttingDown || !s || s.info.status !== 'running' || (s.info.kind !== 'codex' && s.info.kind !== 'claude')) {
      return { ok: false, message: 'Choose a running Codex or Claude terminal.' };
    }
    if (s.info.root.toLowerCase() !== root.toLowerCase()) return { ok: false, message: 'This terminal was started in a different project. Choose a terminal for the brief’s project.' };
    let data: string;
    try { data = encodeTerminalBrief(text); } catch (error) { return { ok: false, message: (error as Error).message }; }
    try { s.process.write(data); return { ok: true }; }
    catch { return { ok: false, message: 'Terminal insertion could not be confirmed. Check its input before retrying.' }; }
  }
  resize(id: string, cols: unknown, rows: unknown) {
    const s = this.sessions.get(id);
    if (s?.info.status === 'running' && typeof cols === 'number' && typeof rows === 'number' && Number.isInteger(cols) && Number.isInteger(rows) && cols >= 2 && cols <= 500 && rows >= 1 && rows <= 250) {
      try { s.process.resize(cols, rows); } catch { /* Exit can race a resize. */ }
    }
  }
  async close(id: string): Promise<boolean> {
    const s = this.sessions.get(id); if (!s) return true;
    if (s.close) return s.close;
    s.close = this.stop(s).finally(() => { s.close = undefined; }); return s.close;
  }
  private async stop(s: Session) {
    if (s.info.status !== 'exited') {
      s.info.status = 'closing'; this.event({ type: 'state', terminal: { ...s.info } });
      await new Promise<void>(resolve => execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'), ['/pid', String(s.process.pid), '/t', '/f'], { windowsHide: true, timeout: 3000 }, () => resolve()));
      s.dispose();
      const stopped = await new Promise<boolean>(resolve => { const timer = setTimeout(() => resolve(false), 5000); void s.exited.then(() => { clearTimeout(timer); resolve(true); }); });
      if (!stopped) return false;
    }
    this.sessions.delete(s.info.id); return true;
  }
  async shutdown() { this.shuttingDown = true; await Promise.allSettled([...this.launches]); await Promise.all([...this.sessions.keys()].map(id => this.close(id))); }
}
