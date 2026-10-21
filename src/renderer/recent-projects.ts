import type { RecentProjectsState, SpecularBridge } from '../shared/types';

export class RecentProjectsView {
  private readonly dialog = document.createElement('dialog');
  private state: RecentProjectsState = { projects: [] };
  private editing = false;

  constructor(private readonly welcome: HTMLElement, private readonly api: SpecularBridge,
    private readonly open: (path: string) => void) {
    this.dialog.id = 'recent-projects-dialog';
    this.dialog.setAttribute('aria-labelledby', 'recent-projects-title');
    document.body.append(this.dialog);
    this.render();
  }
  async refresh() { this.state = await this.api.recentProjects(); this.render(); }
  show() { if (!document.querySelector('dialog[open]')) { this.render(); this.dialog.showModal(); } }
  close() { this.dialog.close(); }
  showError(message: string) { this.state.warning = message; this.render(); }
  private async change(task: () => Promise<RecentProjectsState>) {
    if (this.editing) return;
    this.editing = true; this.render();
    try { this.state = await task(); }
    catch { this.state.warning = 'Could not update recent projects. Please try again.'; }
    finally { this.editing = false; this.render(); }
  }
  private render() {
    for (const target of [this.welcome, this.dialog]) {
      target.replaceChildren();
      const heading = document.createElement('h2'); heading.textContent = 'Recent projects';
      if (target === this.dialog) heading.id = 'recent-projects-title';
      target.append(heading);
      if (this.state.warning) {
        const warning = document.createElement('p'); warning.className = 'recent-warning';
        warning.setAttribute('role', 'alert'); warning.textContent = this.state.warning; target.append(warning);
      }
      const list = document.createElement('ul'); list.className = 'recent-list';
      for (const project of this.state.projects) {
        const row = document.createElement('li');
        const open = document.createElement('button'); open.className = 'recent-open'; open.dataset.project = project.path;
        open.title = project.path;
        const name = document.createElement('strong'); name.textContent = project.name;
        const root = document.createElement('span'); root.textContent = project.path;
        open.append(name, root); open.onclick = () => this.open(project.path);
        const remove = document.createElement('button'); remove.className = 'quiet-button recent-remove'; remove.textContent = 'Remove';
        remove.setAttribute('aria-label', `Remove ${project.path} from recent projects`);
        remove.onclick = () => { void this.change(() => this.api.removeRecent(project.path)); };
        open.disabled = remove.disabled = this.editing;
        row.append(open, remove); list.append(row);
      }
      target.append(list);
      if (!this.state.projects.length) {
        const empty = document.createElement('p'); empty.className = 'recent-empty'; empty.textContent = 'No recent projects. Open a folder to get started.'; target.append(empty);
      }
      const actions = document.createElement('div'); actions.className = 'recent-actions';
      const clear = document.createElement('button'); clear.className = 'quiet-button recent-clear'; clear.textContent = 'Clear recent projects';
      clear.disabled = this.editing || !this.state.projects.length;
      clear.onclick = () => { void this.change(() => this.api.clearRecent()); };
      actions.append(clear);
      if (target === this.dialog) {
        const close = document.createElement('button'); close.className = 'button secondary'; close.textContent = 'Close'; close.onclick = () => this.close(); actions.append(close);
      }
      target.append(actions);
    }
  }
}
