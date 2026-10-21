import type { Finding, ProjectFile, WorkspaceSnapshot } from '../shared/types';

interface TreeNode { path: string; name: string; file?: ProjectFile; children: TreeNode[] }
const parentPath = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

export class FileExplorer {
  private expanded = new Set(['']);
  private filteredExpanded = new Set<string>();
  private query = '';
  private workspace?: WorkspaceSnapshot;
  private findings: Finding[] = [];
  private current?: string;
  private focusPath = '';
  private revealPath?: string;

  constructor(private readonly target: HTMLElement, private readonly open: (file: string) => void) {
    target.setAttribute('role', 'tree');
    target.setAttribute('aria-label', 'Project files');
  }

  reset() { this.expanded = new Set(['']); this.filteredExpanded.clear(); this.query = ''; this.focusPath = ''; this.revealPath = undefined; }

  reveal(file: string) {
    this.revealPath = file;
    for (let folder = parentPath(file); ; folder = parentPath(folder)) {
      this.expanded.add(folder); this.filteredExpanded.add(folder);
      if (!folder) break;
    }
  }

  render(workspace: WorkspaceSnapshot | undefined, findings: Finding[], current: string | undefined, query: string) {
    const previousFolders = new Set(this.workspace?.folders ?? []);
    this.workspace = workspace; this.findings = findings; this.current = current;
    if (query !== this.query) {
      this.query = query;
      this.filteredExpanded = new Set(['', ...(workspace?.folders ?? [])]);
    }
    if (query) for (const path of workspace?.folders ?? []) if (!previousFolders.has(path)) this.filteredExpanded.add(path);
    this.draw();
  }

  private draw() {
    const focused = document.activeElement as HTMLElement | null;
    const restoreFocus = !!focused && this.target.contains(focused);
    if (restoreFocus) this.focusPath = focused!.dataset.treePath ?? this.focusPath;
    this.target.replaceChildren();
    if (!this.workspace) return;
    const root: TreeNode = { path: '', name: this.workspace.name, children: [] };
    const folders = new Map<string, TreeNode>([['', root]]);
    const folder = (path: string): TreeNode => {
      let node = folders.get(path);
      if (!node) {
        node = { path, name: path.split('/').pop()!, children: [] };
        folders.set(path, node); folder(parentPath(path)).children.push(node);
      }
      return node;
    };
    for (const path of this.workspace.folders) folder(path);
    for (const file of this.workspace.files) folder(parentPath(file.path)).children.push({
      path: file.path, name: file.path.split('/').pop()!, file, children: [],
    });
    const filter = (node: TreeNode): boolean => {
      node.children = node.children.filter(filter).sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name));
      return !this.query || node.path.toLowerCase().includes(this.query) || node.children.length > 0;
    };
    filter(root);
    const expanded = this.query ? this.filteredExpanded : this.expanded;
    const counts = new Map<string, number>();
    for (const finding of this.findings) counts.set(finding.file, (counts.get(finding.file) ?? 0) + 1);
    const append = (node: TreeNode, depth: number, position: number, size: number) => {
      const row = document.createElement('button');
      row.type = 'button'; row.className = `file-row${node.file ? '' : ' folder-row'}${node.file && node.path === this.current ? ' active' : ''}`;
      row.dataset.treePath = node.path; row.title = node.path || this.workspace!.root;
      row.style.paddingLeft = `${8 + (depth - 1) * 14}px`;
      row.setAttribute('role', 'treeitem'); row.setAttribute('aria-level', String(depth));
      row.setAttribute('aria-posinset', String(position)); row.setAttribute('aria-setsize', String(size));
      row.setAttribute('aria-selected', String(!!node.file && node.path === this.current));
      const disclosure = document.createElement('span'); disclosure.className = 'tree-disclosure'; disclosure.setAttribute('aria-hidden', 'true');
      disclosure.textContent = node.file ? '' : expanded.has(node.path) ? '▾' : '▸';
      const icon = document.createElement('span'); icon.className = `file-icon${node.file?.configuration ? ' config' : ''}`; icon.setAttribute('aria-hidden', 'true');
      icon.textContent = !node.file ? '▱' : node.file.configuration ? '⚙' : node.file.markdown ? 'M↓' : '‹›';
      const label = document.createElement('span'); label.className = 'file-label'; label.textContent = node.name;
      row.append(disclosure, icon, label);
      if (node.file) {
        row.dataset.file = node.path;
        if (counts.has(node.path)) {
          const badge = document.createElement('span'); badge.className = 'issue-badge'; badge.textContent = String(counts.get(node.path));
          badge.title = `${counts.get(node.path)} pending items or ID issues`; row.append(badge);
        }
      } else { row.dataset.folder = node.path; row.setAttribute('aria-expanded', String(expanded.has(node.path))); }
      const toggle = (open: boolean) => {
        if (open) expanded.add(node.path); else expanded.delete(node.path);
        this.focusPath = node.path; this.draw();
      };
      row.onclick = () => {
        this.focusPath = node.path;
        if (node.file) this.open(node.path); else toggle(!expanded.has(node.path));
      };
      row.onfocus = () => {
        this.focusPath = node.path;
        for (const item of this.rows()) item.tabIndex = item === row ? 0 : -1;
      };
      row.onkeydown = event => {
        const rows = this.rows(); const index = rows.indexOf(row);
        let next: HTMLElement | undefined;
        if (event.key === 'ArrowDown') next = rows[index + 1];
        else if (event.key === 'ArrowUp') next = rows[index - 1];
        else if (event.key === 'Home') next = rows[0];
        else if (event.key === 'End') next = rows.at(-1);
        else if (event.key === 'ArrowRight') {
          if (!node.file && !expanded.has(node.path)) toggle(true);
          else if (!node.file && node.children.length) next = rows[index + 1];
        } else if (event.key === 'ArrowLeft') {
          if (!node.file && expanded.has(node.path)) toggle(false);
          else if (node.path) next = rows.find(item => item.dataset.treePath === parentPath(node.path));
        } else return;
        event.preventDefault(); next?.focus();
      };
      this.target.append(row);
      if (!node.file && expanded.has(node.path)) node.children.forEach((child, index) => append(child, depth + 1, index + 1, node.children.length));
    };
    append(root, 1, 1, 1);
    if (!root.children.length && expanded.has('')) {
      const hint = document.createElement('p'); hint.className = 'empty-hint'; hint.setAttribute('role', 'status');
      hint.textContent = this.query ? 'No matching files or folders.' : 'No supported files or folders.'; this.target.append(hint);
    }
    const rows = this.rows();
    const focus = rows.find(row => row.dataset.treePath === this.focusPath) ?? rows[0];
    for (const row of rows) row.tabIndex = row === focus ? 0 : -1;
    if (restoreFocus) focus?.focus({ preventScroll: true });
    if (this.revealPath) {
      rows.find(row => row.dataset.file === this.revealPath)?.scrollIntoView({ block: 'nearest' });
      this.revealPath = undefined;
    }
  }

  private rows() { return [...this.target.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')]; }
}
