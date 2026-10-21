import { captureLensFocus, groupDefinitions, LensGroups, type LensGrouping } from './lens-groups';
import { FeatureAssignmentEditor } from './feature-assignment-editor';
import { featureBadges, featureEvidence } from './feature-card';
import { idKey, idLabel, keyLabel } from '../core/id-identity';
import { LEGACY_ID_CONFIGURATION } from '../core/id-configuration';
import { ModuleAssignmentEditor } from './module-assignment-editor';
import { statusBadge, statusEvidence } from './statuses';
import { moduleBadges, moduleEvidence } from './module-card';
import { styleCategoryCard } from './category-colors';
import { applyTheme, currentAppearance } from './appearance';
import { observeDialogLayers } from './dialog-layers';
import { registerPluginViews } from './plugin-views';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { CreateDocumentResult, Finding, InstalledPluginInfo, Occurrence, OpenDocument, ProjectIndex, SourceLocation, WorkspaceSnapshot, WorkspaceOpenResult } from '../shared/types';
import { parseMarkdown, slugHeading } from '../core/documents';
import { IndexWorker, type IndexResponse } from '../core/index-worker';
import { ProjectConfigurationDialog } from './project-configuration';
import { relationshipsFor, supportsRelationships } from '../core/relationships';
import { AbstractionViewHost, ViewRegistry, ViewWorkspace, type WorkspaceViewSnapshot } from './abstraction-views';
const FOCUS_VIEW = 'plugin:specular.relationships:focus';
const OVERVIEW_VIEW = 'plugin:specular.relationships:overview';
import { workspaceSurface } from './view-surface';
import { toString } from 'mdast-util-to-string';
import { renderDiagram, renderMarkdown, markdownDiagrams } from './preview';
import { blockAtSource, blockSourcePosition, revealPreviewBlock, visiblePreviewBlock, visibleSourcePosition } from './preview-navigation';
import { captureBriefSource } from '../core/briefs';
import { BriefDialog } from './brief-dialog';
import { capturePreviewSelection } from './preview-selection';
import { FileExplorer } from './file-explorer';
import { PanelSplit } from './panel-split';
import { FontSizeControls } from './font-size-controls';
import { MarkdownSearchPanel, type SearchScope } from './markdown-search';
import { Autosave } from '../core/autosave';
import { RecentProjectsView } from './recent-projects';
import { AgentSetup } from './agent-setup';
import { ConversationPanel } from './codex-conversation';
import { TerminalPanel } from './terminal-panel';
import './styles.css';

const api = window.specular;
observeDialogLayers(api);
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const app = $('#app');
app.innerHTML = `
  <header class="topbar">
    <div class="brand"><img class="brand-mark" src="./specular-logo.svg" width="48" height="48" alt="" /><span>specular<span class="prototype">PROTOTYPE 01</span></span></div>
    <div id="project-heading" class="project-heading">A workspace for software intent</div>
    <button id="show-agent-setup" class="button secondary">Agent setup</button>
    <button id="show-conversation" class="button secondary">Codex chat</button>
    <button id="show-terminals" class="button secondary">Terminal</button>
    <button id="show-recent" class="button secondary">Recent projects</button>
    <button id="open-project" class="button secondary">Open project <kbd>Ctrl O</kbd></button>
    <button id="theme-switch" type="button" role="switch" aria-label="Dark mode" aria-checked="true" title="Dark mode" disabled><span class="theme-sun" aria-hidden="true">☀</span><span class="theme-moon" aria-hidden="true">☾</span></button>
  </header>
  <div id="workbench">
  <div id="welcome" class="welcome">
    <div class="welcome-art" aria-hidden="true"><span>◇</span><span>◇</span><span>◇</span></div>
    <div class="eyebrow">THE SPECIFICATION IS THE STARTING POINT</div>
    <h1>Start with intent.</h1>
    <p>Write in Markdown. Follow the connections.<br>See the system taking shape.</p>
    <div class="welcome-actions"><button id="welcome-open" class="button primary">Open a project <span>↗</span></button><button id="open-demo" class="button secondary">Try the demo project</button></div>
    <section id="welcome-recent" class="recent-projects" aria-label="Recent projects"></section>
    <div class="welcome-features"><span>01 <b>Connected specifications</b>Follow IDs across your project.</span><span>02 <b>Living diagrams</b>Turn Mermaid into a view.</span><span>03 <b>Visible pending work</b>Keep open questions in sight.</span></div>
  </div>
  <main id="workspace" class="workspace" hidden>
    <aside class="explorer">
      <div class="section-heading">EXPLORER<button id="refresh" class="icon-button" title="Refresh project" aria-label="Refresh project">↻</button></div>
      <input id="file-search" class="search" aria-label="Filter files" placeholder="Filter files…" />
      <button id="new-file" class="button secondary new-file-button" title="New Markdown file (Ctrl+N)">New Markdown file</button>
      <button id="markdown-search-open" class="button secondary new-file-button" title="Search Markdown (Ctrl+Shift+F)">Search Markdown</button>
      <div class="explorer-label">PROJECT FILES <span id="file-count"></span></div>
      <div id="files" class="files"></div>
      <div class="explorer-footer"><span class="status-dot"></span> Local Markdown workspace</div>
    </aside>
    <section class="document-area">
      <div id="tabs" class="tabs" role="tablist" aria-label="Workspace tabs"></div>
      <div id="abstraction-views"></div>
      <div class="document-toolbar"><div id="document-path" class="document-path">Choose a document</div><span id="dirty-indicator" role="status" aria-live="polite"></span><button id="retry-save" class="quiet-button" hidden>Retry saving</button><button id="toggle-source" class="quiet-button" aria-controls="source-panel" aria-expanded="true" disabled>Hide source</button><button id="reset-split" class="quiet-button" title="Reset source and preview widths to 50/50" aria-label="Reset source and preview widths" disabled>50/50</button><button id="prepare-brief" class="button brief-button" title="Prepare a brief from selected Markdown" disabled>Prepare agent brief</button><button id="reload" class="quiet-button" title="Reload the file from disk">Reload</button></div>
      <div id="conflict" class="conflict" role="alert" hidden></div>
      <div id="document-empty" class="document-empty" hidden><h2>No document open</h2><p>Choose a file in the explorer or follow a project ID to open it.</p></div>
      <div class="document-split">
        <section id="source-panel" class="editor-pane"><div class="pane-heading"><span>SOURCE</span><div class="pane-actions"><button id="show-in-preview" class="quiet-button" title="Align the preview with the visible source cursor, or the top visible source line" disabled>Show in preview →</button><button id="follow-id" class="quiet-button" title="Follow the ID at the cursor (F12)">Follow ID <kbd>F12</kbd></button></div></div><div id="editor" aria-label="Document editor"></div></section>
        <div id="panel-divider" role="separator" tabindex="0" aria-label="Source and preview widths" aria-orientation="vertical" aria-controls="source-panel preview-panel" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" title="Drag to resize. Left/Right: adjust; Shift: fine adjustment; Home/End: limits; Enter or double-click: 50/50."></div>
        <section id="preview-panel" class="preview-pane"><div class="pane-heading"><div class="view-switch"><button id="preview-tab" class="selected" aria-pressed="true">Preview</button><button id="diagrams-tab" aria-pressed="false">Diagrams <span id="diagram-count">0</span></button></div><button id="show-in-source" class="quiet-button" title="Align the source with the visible preview selection, or the top visible block" disabled>← Show in source</button></div><div id="preview" class="markdown-body"></div></section>
      </div>
    </section>
    <aside class="inspector">
      <div class="section-heading">PROJECT LENS<button id="project-config-open" class="quiet-button" aria-label="Project configuration…" title="Project configuration" disabled>Configure…</button></div>
      <div class="metrics"><div><strong id="metric-docs">0</strong><span>documents</span></div><div><strong id="metric-ids">0</strong><span>IDs</span></div><div><strong id="metric-pending">0</strong><span>pending</span></div></div>
      <div class="lens-plugin-actions"><button id="plugin-view-open" class="quiet-button" aria-label="Install plugin folder...">Install plugin…</button><button id="plugin-manager-open" class="quiet-button plugin-manager-open">Manage plugins...</button></div>
      <div id="loaded-plugin-views"></div>
      <button id="dependency-overview-open" class="button secondary dependency-overview-open">Dependency overview</button>
      <div class="lens-tabs"><button id="index-tab" class="selected">Index</button><button id="pending-tab">Issues <span id="issue-count">0</span></button></div>
      <input id="id-search" class="search" aria-label="Search IDs" placeholder="Find an ID or requirement…" />
      <label id="module-filter-row" hidden>Module <select id="module-filter" aria-label="Filter by module"><option value="">All modules</option></select></label>
      <label id="lens-grouping-row">Group by <select id="lens-grouping" aria-label="Group definitions by"><option value="none">None</option><option value="status">Status</option><option value="module">Module</option><option value="feature">Feature</option></select></label>
      <div id="lens-heading" class="explorer-label">DEFINITIONS</div><div id="lens-results" class="lens-results"></div>
      <div id="references-panel" class="references-panel" hidden><div class="section-heading"><span id="references-title">REFERENCES</span><button id="close-references" class="icon-button" aria-label="Close references">×</button></div><div id="references-results"></div></div>
      <div id="warnings" class="warnings" hidden></div>
    </aside>
  </main>
  </div>
  <footer class="statusbar"><div><span class="status-dot"></span><span id="status">Ready to explore</span></div><div><span id="cursor-status"></span><span id="token-status"></span><span>UTF-8</span></div></footer>
  <div id="toast" class="toast" role="status" hidden></div>
  <dialog id="confirm-dialog"><h2 id="confirm-title"></h2><p id="confirm-message"></p><div class="dialog-actions"><button id="confirm-cancel" class="button secondary">Keep editing</button><button id="confirm-accept" class="button primary">Discard changes</button></div></dialog>
  <dialog id="new-file-dialog" aria-labelledby="new-file-title" aria-describedby="new-file-location"><form id="new-file-form">
    <h2 id="new-file-title">New Markdown file</h2><p id="new-file-location"></p>
    <label for="new-file-name">Filename</label><input id="new-file-name" class="search" placeholder="notes.md" autocomplete="off" aria-describedby="new-file-hint new-file-error" />
    <p id="new-file-hint">Created in the project root. Add .md, or leave off the extension.</p>
    <p id="new-file-error" class="coral" role="alert" hidden></p>
    <div class="dialog-actions"><button id="new-file-cancel" type="button" class="button secondary">Cancel</button><button id="new-file-create" type="submit" class="button primary">Create</button></div>
  </form></dialog>
  <dialog id="close-tab-dialog" aria-labelledby="close-tab-title" aria-describedby="close-tab-message"><h2 id="close-tab-title">Could not save changes</h2><p id="close-tab-message"></p><p id="close-tab-error" class="coral" role="alert"></p><div class="dialog-actions"><button id="close-tab-cancel" class="button secondary">Keep editing</button><button id="close-tab-discard" class="button secondary">Discard pending edits</button><button id="close-tab-retry" class="button primary">Retry saving</button></div></dialog>
  <dialog id="plugin-manager-dialog" aria-labelledby="plugin-manager-title"><h2 id="plugin-manager-title">Installed plugins</h2><p>Installed packages are stored by Specular and remain available after restart.</p><div id="plugin-manager-list" class="plugin-manager-list"></div><p id="plugin-manager-empty">No plugins are installed.</p><div class="dialog-actions plugin-manager-actions"><button id="plugin-install-archive" class="button secondary">Install .zip...</button><button id="plugin-install-folder" class="button secondary">Install folder...</button><button id="plugin-manager-close" class="button primary">Close</button></div></dialog>
`;

interface BufferState extends OpenDocument { state: EditorState; savedText: string; conflict?: string; autosave?: Autosave }
const buffers = new Map<string, BufferState>();
const readOnly = new Compartment();
const language = new Compartment();
let workspace: WorkspaceSnapshot | undefined;
let current: string | undefined;
let index: ProjectIndex = { definitions: [], references: [], findings: [], diagrams: [] };
let lensMode: 'index' | 'issues' = 'index';
const lensGroups = new LensGroups();
let viewMode: 'preview' | 'diagrams' = 'preview';
let sourceHidden = false;
const sourceScroll = new Map<string, ReturnType<EditorView['scrollSnapshot']>>();
let updating = false;
let revision = 0;
let indexReady = false;
let indexDocuments: Record<string, string> = {};
let pendingIndexDocuments: Record<string, string> = {};
let indexNotice = 'Updating the Markdown index...';
let previewTimer: ReturnType<typeof setTimeout>;
let toastTimer: ReturnType<typeof setTimeout>;
let openRevision = 0;
let projectRevision = 0;
let refreshing = false;
let refreshAgain = false;
let referencesFor: string | undefined;
let referenceMode: 'occurrences' | 'relationships' = 'occurrences';
const expandedRelationships = new Set<string>();
let closingTab = false;
let projectOpening = false;
let departing = false;
let sessionSignature = '';
let pendingSession = Promise.resolve();
let projectSettled = Promise.resolve();
let markdownSearch: MarkdownSearchPanel | undefined;
let projectConfiguration: ProjectConfigurationDialog | undefined;
let featureAssignmentEditor: FeatureAssignmentEditor | undefined;
let moduleAssignmentEditor: ModuleAssignmentEditor | undefined;
let moduleFocus: { id: string; project: number; dimension?: 'modules' | 'features' } | undefined;
const worker = new IndexWorker(() => new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' }), receiveIndex);
const viewRegistry = new ViewRegistry();
const registeredPlugins = new Map<string, { view: string; signature: string }>();
const viewWorkspace = new ViewWorkspace(workspaceViewSnapshot(), async evidence => {
  if (evidence.projectId !== workspaceProjectId()) throw new Error('The project changed. Choose the updated result again.');
  await openDocument(evidence.source.file, evidence.source, undefined, evidence.revision);
}, showReferences, notifyError);
const viewHost = new AbstractionViewHost(viewRegistry, viewWorkspace, workspaceSurface($('#abstraction-views')),
  () => { syncWorkspaceView(); renderTabs(); }, () => { ++openRevision; });
window.addEventListener('beforeunload', () => viewHost.dispose());
function workspaceProjectId() { return workspace ? `${projectRevision}:${workspace.root}` : ''; }
// Index offsets and public source ranges must refer to the same text as CodeMirror.
// Normalize unopened disk documents too, so opening a CRLF file cannot shift offsets.
function currentMarkdownDocuments(): Record<string, string> {
  const documents = Object.fromEntries(Object.entries(workspace?.documents ?? {}).map(([file, text]) => [file, text.replace(/\r\n|\r/g, '\n')]));
  for (const [file, buffer] of buffers) if (/\.(md|markdown)$/i.test(file)) documents[file] = buffer.state.doc.toString();
  return documents;
}
function workspaceViewSnapshot(): WorkspaceViewSnapshot {
  return { projectId: workspaceProjectId(), currentFile: current, revision, ready: indexReady, notice: indexNotice,
    documents: currentMarkdownDocuments(), configuration: workspace?.idConfiguration?.configuration ?? LEGACY_ID_CONFIGURATION, folders: workspace?.folders ?? [], files: (workspace?.files ?? []).map(file => ({ path: file.path, markdown: file.markdown })),
    index, warnings: workspace?.warnings ?? [] };
}
function publishViewSnapshot() { viewWorkspace.publish(workspaceViewSnapshot()); markdownSearch?.update(); projectConfiguration?.update(); moduleAssignmentEditor?.update(); featureAssignmentEditor?.update(); }
const isMarkdown = (file: string) => /\.(md|markdown)$/i.test(file);
const normalized = (text: string) => text.replace(/\r\n|\r/g, '\n');
const isDirty = (buffer: BufferState) => buffer.state.doc.toString() !== normalized(buffer.savedText) || !!buffer.autosave?.saving;

function run(task: () => Promise<unknown>) { void task().catch(notifyError); }
function notify(message: string) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6500);
}
function notifyError(error: unknown) { notify(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error)); }
function setStatus(message: string) { $('#status').textContent = message; }
function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.className = className;
  element.textContent = label;
  element.onclick = onClick;
  return element;
}
function confirmDiscard(title: string, message: string): Promise<boolean> {
  const dialog = $<HTMLDialogElement>('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  return new Promise(resolve => {
    const finish = (result: boolean) => { dialog.close(); resolve(result); };
    $('#confirm-cancel').onclick = () => finish(false);
    $('#confirm-accept').onclick = () => finish(true);
    dialog.oncancel = event => { event.preventDefault(); finish(false); };
    dialog.showModal();
  });
}
const themeCompartment = new Compartment();
const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--surface-base, #14181e)', color: 'var(--text-primary, #d3dce4)', fontSize: 'var(--source-font-size, 13px)' },
  '.cm-content': { fontFamily: 'Consolas, "Cascadia Code", monospace', padding: '16px 0', caretColor: 'var(--text-accent, #83dad2)' },
  '.cm-gutters': { backgroundColor: 'var(--surface-base, #14181e)', color: 'var(--border-strong, #596671)', border: 'none', minWidth: '40px' },
  '.cm-line': { padding: '0 16px 0 8px', lineHeight: '1.75' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--surface-raised, #1b232b)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--surface-selected, #27444e) !important' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto' },
  '.cm-panels': { backgroundColor: 'var(--surface-raised, #202a33)', color: 'var(--text-primary, #e1e8ed)' },
});
const highlighting = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--text-accent, #cce9e3)', fontWeight: '600' },
  { tag: tags.meta, color: 'var(--text-muted, #87b7c8)' },
  { tag: tags.processingInstruction, color: 'var(--text-muted, #92c0cd)' },
  { tag: tags.monospace, color: 'var(--text-accent, #b6cec7)' },
  { tag: tags.link, color: 'var(--text-accent, #8fd0c6)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--text-muted, #9cbcd1)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, color: 'var(--text-primary, #e4ded0)', fontWeight: '600' },
  { tag: tags.comment, color: 'var(--text-accent, #91a0aa)' },
  { tag: tags.keyword, color: 'var(--text-primary, #a6bcdf)' },
  { tag: tags.string, color: 'var(--text-accent, #c5d6aa)' },
]);

function createState(text: string, editable: boolean): EditorState {
  return EditorState.create({ doc: normalized(text), extensions: [basicSetup, editorTheme, themeCompartment.of(EditorView.theme({}, { dark: currentAppearance().mode === 'dark' })), syntaxHighlighting(highlighting), EditorView.lineWrapping,
    language.of(editable ? markdown() : []), readOnly.of(EditorState.readOnly.of(!editable)),
    EditorView.contentAttributes.of({ 'aria-label': editable ? 'Markdown source' : 'Code source', spellcheck: 'false' }),
    keymap.of([{ key: 'Mod-s', run: () => { run(save); return true; } },
      { key: 'F12', run: () => { followCursor(false); return true; } },
      { key: 'Shift-F12', run: () => { followCursor(true); return true; } }, indentWithTab]),
    EditorView.domEventHandlers({ mousedown(event, view) {
      if (!(event.ctrlKey || event.metaKey)) return false;
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (position === null) return false;
      const id = idAt(position);
      if (!id) return false;
      event.preventDefault();
      if (event.shiftKey) showReferences(id); else run(() => navigateId(id));
      return true;
    } }),
    EditorView.updateListener.of(update => {
      if (updating || !current) return;
      const buffer = buffers.get(current)!;
      buffer.state = update.state;
      if (update.docChanged) {
        buffer.text = update.state.doc.toString();
        buffer.autosave?.edit();
        updateDirty();
        invalidateIndex();
        clearTimeout(previewTimer);
        previewTimer = setTimeout(() => {
          requestIndex();
          if (renderedFile !== current || renderedMarkdown !== editor.state.doc.toString()) renderPreview();
        }, 220);
      }
      updateStats();
    }),
  ] });
}
const editor = new EditorView({ state: createState('', false), parent: $('#editor') });
const fontSizes = new FontSizeControls(api, () => {
  const selection = window.getSelection();
  if (selection?.anchorNode && $('#preview').contains(selection.anchorNode)) {
    const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
    // A focused CodeMirror can restore its DOM selection during layout; retain preview selection instead.
    editor.contentDOM.blur();
    if (anchorNode.isConnected && focusNode?.isConnected) selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
  }
  editor.requestMeasure();
}, notify);
const panelSplit = new PanelSplit($('.document-split'), $('#panel-divider'), $<HTMLButtonElement>('#reset-split'), () => editor.requestMeasure());
function rememberSourceScroll() {
  if (current && buffers.has(current) && !$('#source-panel').hidden) sourceScroll.set(current, editor.scrollSnapshot());
}
function syncSourceVisibility() {
  const markdown = !!current && isMarkdown(current);
  const hidden = markdown && sourceHidden;
  const toggle = $<HTMLButtonElement>('#toggle-source');
  if (hidden && $('#source-panel').contains(document.activeElement)) toggle.focus();
  $('#source-panel').hidden = hidden;
  $('#panel-divider').hidden = hidden;
  $('.document-split').classList.toggle('source-hidden', hidden);
  toggle.disabled = !markdown;
  toggle.textContent = hidden ? 'Show source' : 'Hide source';
  toggle.setAttribute('aria-expanded', String(!hidden));
  $<HTMLButtonElement>('#reset-split').disabled = !current || hidden;
  panelSplit.refresh();
}
function setSourceHidden(hidden: boolean) {
  rememberSourceScroll();
  sourceHidden = hidden;
  syncSourceVisibility();
  const scroll = current ? sourceScroll.get(current) : undefined;
  if (!hidden && scroll) editor.dispatch({ effects: scroll });
}
$('#toggle-source').onclick = () => {
  setSourceHidden(!sourceHidden);
  $('#toggle-source').focus();
};
const briefDialog = new BriefDialog(text => api.copyBrief(text), () => editor.focus(), {
  targets: () => terminalPanel.briefTargets(),
  insert: (id, root, text) => terminalPanel.insertBrief(id, root, text),
  reveal: id => terminalPanel.revealBrief(id),
}, {
  state: () => api.conversationState(),
  models: () => api.codexModels(),
  send: (root, text, model) => api.sendCodexBrief(root, text, model),
  reveal: () => { void conversationPanel.show(); },
});
let renderedMarkdown = '';
let renderedIds = '';
function currentOccurrences(): Occurrence[] {
  if (!indexReady || !current || normalized(indexDocuments[current] ?? '') !== editor.state.doc.toString()) return [];
  return [...index.definitions, ...index.references].filter(item => item.file === current);
}
function occurrenceSignature() { return JSON.stringify(currentOccurrences().map(item => [item.offset, item.end, idKey(item)])); }
let renderedFile: string | undefined;
let previewGeneration = 0;
let previewRendering: Promise<void> = Promise.resolve();
function prepareBrief() {
  try {
    if (!current) { notify('Open a Markdown file to prepare an agent brief.'); return; }
    if (!indexReady) { notify(indexNotice); return; }
    const buffer = buffers.get(current)!;
    const selection = editor.state.selection.main;
    const text = editor.state.doc.toString();
    const sources = [];
    if (text.slice(selection.from, selection.to).trim()) sources.push(captureBriefSource(current, text,
      selection.from, selection.to, isDirty(buffer), Boolean(buffer.conflict), currentOccurrences()));
    if (viewMode === 'preview') {
      const preview = capturePreviewSelection($('#preview'), current, isDirty(buffer), Boolean(buffer.conflict));
      if (preview && renderedMarkdown !== text) { notify('The preview is updating. Select its text again once it refreshes.'); return; }
      if (preview) sources.push(preview);
    }
    if (!sources.length) { notify('Select some Markdown in the source editor or text in the preview first.'); return; }
    briefDialog.open(sources, workspace!.root);
  } catch (error) { notifyError(error); }
}
function idAt(position: number): string | undefined {
  const item = currentOccurrences().find(item => position >= item.offset && position <= item.end);
  return item && idKey(item);
}
function followCursor(references: boolean) {
  const id = idAt(editor.state.selection.main.head);
  if (!id) { notify('Place the cursor on an ID, such as REQ-001.'); return; }
  if (references) showReferences(id); else run(() => navigateId(id));
}
function updateDirty() {
  const dirty = [...buffers.values()].some(isDirty);
  api.setDirty(dirty);
  const buffer = current ? buffers.get(current) : undefined;
  for (const id of ['show-in-preview', 'show-in-source']) {
    $<HTMLButtonElement>('#' + id).disabled = !buffer || !isMarkdown(buffer.path) || !buffer.state.doc.toString().trim();
  }
  $('#dirty-indicator').textContent = buffer?.autosave?.status ?? '';
  $('#dirty-indicator').title = buffer?.autosave?.error ?? '';
  $('#retry-save').hidden = !buffer?.autosave?.error || buffer.autosave.conflict;
  $<HTMLButtonElement>('#prepare-brief').disabled = !buffer || !isMarkdown(buffer.path);
  $<HTMLButtonElement>('#reload').disabled = !buffer;
  syncSourceVisibility();
  $<HTMLButtonElement>('#follow-id').disabled = !buffer;
  $('#conflict').hidden = !(buffer?.conflict || buffer?.autosave?.error);
  $('#conflict').textContent = buffer?.conflict ?? buffer?.autosave?.error ?? '';
  document.title = `${buffer && isDirty(buffer) ? '● ' : ''}${current ? current + ' — ' : ''}Specular`;
  renderTabs();
  void persistWorkspaceSession();
}
function persistWorkspaceSession(force = false): Promise<void> {
  if (!workspace || projectOpening) return pendingSession;
  const root = workspace.root;
  const session = { files: [...buffers.keys()], activeFile: current };
  const signature = JSON.stringify({ root, ...session });
  if (!force && signature === sessionSignature) return pendingSession;
  sessionSignature = signature;
  pendingSession = pendingSession.then(async () => {
    try {
      const result = await api.saveWorkspaceSession(root, session);
      if (!result.ok) throw new Error(result.message || 'Workspace tabs could not be saved.');
    } catch (error) {
      if (sessionSignature === signature) sessionSignature = '';
      notifyError(error);
    }
  });
  return pendingSession;
}
function updateStats() {
  const position = editor.state.selection.main.head;
  const line = editor.state.doc.lineAt(position);
  $('#cursor-status').textContent = current ? `Ln ${line.number}, Col ${position - line.from + 1}` : '';
  const selection = editor.state.selection.main;
  const text = selection.empty ? editor.state.doc.toString() : editor.state.sliceDoc(selection.from, selection.to);
  $('#token-status').textContent = current ? `~${Math.ceil(text.length / 4).toLocaleString()} tokens${selection.empty ? '' : ' selected'} · estimate` : '';
  $('#token-status').title = 'Rough character-count estimate (characters ÷ 4), not a model tokenizer or usage bill.';
}
function hasView(id: string) { try { return !!viewRegistry.definition(id); } catch { return false; } }
function activateOverview() { if (hasView(OVERVIEW_VIEW)) viewHost.openView(OVERVIEW_VIEW); else notify('Enable the Relationships plugin to open Overview.'); }
function activateMap(id?: string) { if (hasView(FOCUS_VIEW)) viewHost.openView(FOCUS_VIEW, id === undefined ? undefined : { elementId: id }); else notify('Enable the Relationships plugin to open Focus.'); }
function closeView(group = viewHost.activeGroup) {
  if (group) viewHost.close(group);
  if (current && !viewHost.activeGroup) editor.focus();
}
function syncWorkspaceView() {
  $('.document-area').classList.toggle('abstraction-active', !!viewHost.activeGroup);
  markdownSearch?.update();
}
function renderTabs() {
  const parent = $('#tabs'); parent.replaceChildren();
  for (const [file, buffer] of buffers) {
    const group = document.createElement('div'); group.className = `tab-group${file === current && !viewHost.activeGroup ? ' active' : ''}`;
    group.setAttribute('role', 'presentation');
    const tab = button(`${file.split('/').pop()}${isDirty(buffer) ? ' ●' : ''}`, `tab${file === current && !viewHost.activeGroup ? ' active' : ''}`, () => run(() => openDocument(file)));
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(file === current && !viewHost.activeGroup)); tab.title = file;
    const close = button('×', 'tab-close', () => run(() => closeTab(file)));
    close.setAttribute('aria-label', `Close ${file}`); close.title = `Close ${file} (Ctrl+W for active tab)`;
    group.append(tab);
    if (buffer.autosave && buffer.autosave.status !== 'Saved') {
      const status = document.createElement('span'); status.className = 'tab-save-status';
      status.textContent = buffer.autosave.status; status.title = buffer.autosave.error ?? buffer.autosave.status;
      group.append(status);
    }
    group.append(close); parent.append(group);
  }
  for (const definition of viewHost.tabs) {
    const active = viewHost.activeGroup === definition.id;
    const group = document.createElement('div'); group.className = `tab-group${active ? ' active' : ''}`;
    const tab = button(definition.title, `tab${active ? ' active' : ''}`, () => viewHost.openGroup(definition.id));
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(active)); tab.setAttribute('aria-controls', definition.containerId);
    const close = button('\u00d7', 'tab-close', () => closeView(definition.id)); close.setAttribute('aria-label', `Close ${definition.title}`);
    group.append(tab, close); parent.append(group);
  }
}
function showEmptyDocument() {
  current = undefined;
  publishViewSnapshot();
  updating = true; editor.setState(createState('', false)); updating = false;
  $('#document-empty').hidden = false; $('.document-split').hidden = true;
  $('#document-path').textContent = 'Choose a document';
  $('#preview').replaceChildren(); $('#diagram-count').textContent = '0';
  renderedMarkdown = '';
  updateDirty(); updateStats(); renderFiles();
}
function confirmCloseTab(file: string): Promise<'saved' | 'discard' | 'cancel'> {
  const dialog = $<HTMLDialogElement>('#close-tab-dialog');
  $('#close-tab-message').textContent = `${file} has pending edits. They are kept until saving succeeds or you explicitly discard them.`;
  const error = $('#close-tab-error'); error.hidden = false; error.textContent = buffers.get(file)?.autosave?.error ?? buffers.get(file)?.conflict ?? '';
  let saving = false;
  const controls = [...dialog.querySelectorAll<HTMLButtonElement>('button')];
  controls.forEach(control => { control.disabled = false; });
  $<HTMLButtonElement>('#close-tab-retry').disabled = !!buffers.get(file)?.autosave?.conflict;
  return new Promise(resolve => {
    const finish = (choice: 'saved' | 'discard' | 'cancel') => { dialog.close(); resolve(choice); };
    $('#close-tab-cancel').onclick = () => finish('cancel');
    $('#close-tab-discard').onclick = () => finish('discard');
    dialog.oncancel = event => { event.preventDefault(); if (!saving) finish('cancel'); };
    $('#close-tab-retry').onclick = async () => {
      if (saving) return;
      saving = true; controls.forEach(control => { control.disabled = true; });
      error.hidden = true;
      try {
        if (await saveBuffer(file)) { finish('saved'); return; }
        error.textContent = buffers.get(file)?.autosave?.error ?? 'The document still has pending changes. Try saving again.';
      } catch (failure) {
        error.textContent = failure instanceof Error ? failure.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(failure);
      } finally {
        saving = false; controls.forEach(control => { control.disabled = false; });
        $<HTMLButtonElement>('#close-tab-retry').disabled = !!buffers.get(file)?.autosave?.conflict;
      }
      error.hidden = false;
    };
    dialog.showModal();
    $('#close-tab-cancel').focus();
  });
}
async function closeTab(file: string) {
  if (closingTab || projectOpening || departing || document.querySelector('dialog[open]')) return;
  const buffer = buffers.get(file);
  if (!buffer) return;
  closingTab = true;
  freezeWorkspace(true); buffer.autosave?.pause();
  const keepViewActive = viewHost.activeGroup;
  const project = projectRevision;
  ++openRevision; // Do not let an earlier asynchronous navigation reopen a closed tab.
  try {
    const saved = await buffer.autosave?.flush() ?? true;
    if (project !== projectRevision || buffers.get(file) !== buffer) return;
    const choice = !saved && isDirty(buffer) ? await confirmCloseTab(file) : 'saved';
    if (choice === 'cancel' || project !== projectRevision || buffers.get(file) !== buffer) return;
    // A save must never close a buffer that acquired newer edits while awaiting disk I/O.
    if (choice === 'saved' && isDirty(buffer)) return;
    const files = [...buffers.keys()];
    const position = files.indexOf(file);
    const wasActive = current === file;
    buffer.autosave?.dispose(); buffers.delete(file); sourceScroll.delete(file);
    invalidateIndex();
    clearTimeout(previewTimer);
    if (wasActive) {
      const adjacent = files[position + 1] ?? files[position - 1];
      if (adjacent) { await openDocument(adjacent); editor.focus(); }
      else { showEmptyDocument(); $('#file-search').focus(); }
    } else { updateDirty(); updateStats(); }
    requestIndex();
    if (choice === 'discard') run(refresh);
  } finally {
    if (keepViewActive && project === projectRevision && viewHost.isOpen(keepViewActive)) viewHost.openGroup(keepViewActive);
    closingTab = false;
    freezeWorkspace(false); if (buffers.get(file) === buffer) buffer.autosave?.resume();
  }
}
const fileExplorer = new FileExplorer($('#files'), file => run(() => openDocument(file)));
function renderFiles() {
  fileExplorer.render(workspace, index.findings, current, $<HTMLInputElement>('#file-search').value.toLowerCase());
  $('#file-count').textContent = String(workspace?.files.length ?? 0);
}
async function useWorkspace(next: WorkspaceSnapshot) {
  for (const buffer of buffers.values()) buffer.autosave?.dispose();
  projectRevision++; openRevision++;
  clearTimeout(previewTimer);
  buffers.clear(); sourceScroll.clear(); sourceHidden = false; current = undefined; workspace = next;
  viewHost.reset();
  sessionSignature = '';
  fileExplorer.reset();
  index = { definitions: [], references: [], findings: [], diagrams: [] };
  referencesFor = undefined; expandedRelationships.clear(); $('#references-panel').hidden = true;
  $('#welcome').hidden = true; $('#workspace').hidden = false;
  $<HTMLSelectElement>('#module-filter').value = '';
  $<HTMLSelectElement>('#lens-grouping').value = 'none'; lensGroups.reset();
  $('#project-heading').textContent = next.name; $('#project-heading').title = next.root;
  $<HTMLButtonElement>('#project-config-open').disabled = false;
  $('#file-search').setAttribute('value', ''); $<HTMLInputElement>('#file-search').value = '';
  showEmptyDocument();
  updateDirty(); renderFiles(); renderWarnings(); requestIndex();
  if (next.session) {
    for (const file of next.session.files) {
      try { await openDocument(file); }
      catch { next.warnings.push(`Could not restore saved tab: ${file}`); }
    }
    const active = next.session.activeFile && buffers.has(next.session.activeFile) ? next.session.activeFile : buffers.keys().next().value;
    if (active) await openDocument(active);
  } else {
    const first = next.files.find(file => /(^|\/)README\.md$/i.test(file.path)) ?? next.files.find(file => file.markdown);
    if (first) {
      try { await openDocument(first.path); }
      catch { next.warnings.push(`Could not open ${first.path}. Choose another document in the explorer.`); }
    }
  }
  renderWarnings();
  setStatus(`${next.name} · ${next.files.length} text files`);
}
async function openDocument(file: string, source?: SourceLocation, anchor?: string, indexedRevision?: number,
  expected?: { text: string; valid: () => boolean }) {
  if (expected && !expected.valid()) return;
  if (indexedRevision !== undefined && (!indexReady || indexedRevision !== revision)) { notify('The index changed. Choose the updated result again.'); return; }
  const request = ++openRevision;
  let buffer = buffers.get(file);
  if (!buffer) {
    const document = await api.readDocument(file);
    if (request !== openRevision || (indexedRevision !== undefined && (!indexReady || indexedRevision !== revision))) return;
    if (expected && !expected.valid()) return;
    if (expected && normalized(document.text) !== expected.text) {
      if (workspace) workspace.documents[file] = document.text;
      requestIndex(); notify('The file changed since searching. Choose an updated match.'); return;
    }
    buffer = createBuffer(document);
    buffers.set(file, buffer);
  }
  if (expected && buffer.state.doc.toString() !== expected.text) {
    publishViewSnapshot(); notify('The document changed since searching. Choose an updated match.'); return;
  }
  const changedIndexedSource = indexedRevision !== undefined && buffer.state.doc.toString() !== normalized(indexDocuments[file] ?? '');
  if (changedIndexedSource) { source = undefined; notify('The source changed since indexing. Choose its updated location after refresh.'); }
  rememberSourceScroll();
  current = file;
  viewHost.showDocument();
  const filter = $<HTMLInputElement>('#file-search');
  if (!file.toLowerCase().includes(filter.value.toLowerCase())) filter.value = '';
  fileExplorer.reveal(file);
  $('#document-empty').hidden = true; $('.document-split').hidden = false;
  updating = true; editor.setState(buffer.state); updating = false;
  $('#document-path').textContent = `${file}${isMarkdown(file) ? '' : ' · read-only'}`;
  updateDirty(); updateStats(); renderFiles(); renderPreview();
  if (!source && !anchor && !$('#source-panel').hidden) {
    const scroll = sourceScroll.get(file);
    if (scroll) editor.dispatch({ effects: scroll });
  }
  if (source) {
    setSourceHidden(false);
    const line = editor.state.doc.line(Math.min(source.line, editor.state.doc.lines));
    const from = Math.min(line.to, line.from + source.column - 1);
    const to = Math.min(line.to, from + source.end - source.offset);
    editor.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
    editor.focus();
  }
  if (changedIndexedSource) requestIndex();
  else publishViewSnapshot();
  if (anchor) {
    const heading = [...$('#preview').querySelectorAll<HTMLElement>('[id]')].find(item => item.id === anchor);
    heading?.scrollIntoView({ block: 'start' });
    const tree = parseMarkdown(buffer.state.doc.toString());
    const target = tree.children.find(node => node.type === 'heading' && slugHeading(toString(node)) === anchor);
    if (target?.position) {
      setSourceHidden(false);
      const from = editor.state.doc.line(target.position.start.line).from;
      editor.dispatch({ selection: { anchor: from }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
    } else if (!heading) notify(`The file opened, but heading “${anchor}” was not found.`);
  }
}
function newMarkdownFile() {
  if (projectOpening || closingTab || departing) return;
  if (!workspace) { notify('Open a project first.'); return; }
  if (document.querySelector('dialog[open]')) return;
  const dialog = $<HTMLDialogElement>('#new-file-dialog');
  const input = $<HTMLInputElement>('#new-file-name');
  const error = $('#new-file-error');
  const controls = [...dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')];
  const project = projectRevision;
  let creating = false;
  input.value = ''; error.hidden = true;
  controls.forEach(control => { control.disabled = false; });
  $('#new-file-location').textContent = `Project: ${workspace.root}`;
  $('#new-file-cancel').onclick = () => dialog.close();
  dialog.oncancel = event => { if (creating) event.preventDefault(); };
  $('#new-file-form').onsubmit = async event => {
    event.preventDefault();
    if (creating) return;
    creating = true; error.hidden = true;
    controls.forEach(control => { control.disabled = true; });
    let result: CreateDocumentResult;
    try { result = await api.createMarkdown(input.value); }
    catch (failure) {
      result = { ok: false, message: failure instanceof Error ? failure.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(failure) };
    }
    if (!result.ok) {
      error.textContent = result.message;
      error.hidden = false; creating = false;
      controls.forEach(control => { control.disabled = false; });
      input.focus(); return;
    }
    const created = result.document;
    if (project !== projectRevision) { dialog.close(); return; }
    // Creation succeeded even if a later refresh/read fails: never invite a duplicate retry.
    try {
      await refresh();
      if (project !== projectRevision) return;
      await openDocument(created.path);
      dialog.close(); editor.focus();
      notify(`Created ${created.path}`);
    } catch (failure) { dialog.close(); notifyError(failure); }
    finally { if (dialog.open) dialog.close(); }
  };
  dialog.showModal(); input.focus();
}
async function save() {
  if (!current) return;
  await saveBuffer(current);
}
function saveBuffer(file: string): Promise<boolean> { return buffers.get(file)?.autosave?.flush(true) ?? Promise.resolve(true); }
function createBuffer(document: OpenDocument): BufferState {
  const buffer: BufferState = { ...document, savedText: document.text, state: createState(document.text, isMarkdown(document.path)) };
  if (isMarkdown(document.path)) {
    const project = workspace!.root;
    buffer.autosave = new Autosave({
      text: () => buffer.state.doc.toString(), savedText: () => normalized(buffer.savedText), version: () => buffer.version,
      write: (text, version) => api.saveDocument(buffer.path, text, version, project),
      saved: saved => {
        if (buffers.get(buffer.path) !== buffer) return;
        buffer.version = saved.version; buffer.savedText = saved.text; buffer.conflict = undefined;
        if (workspace?.root === project) workspace.documents[buffer.path] = saved.text;
        requestIndex();
      },
      changed: () => { if (buffers.get(buffer.path) === buffer) { updateDirty(); publishViewSnapshot(); } },
    });
  }
  return buffer;
}
function freezeWorkspace(inert: boolean) {
  for (const selector of ['#workspace', '#welcome', '.topbar', '#terminal-panel']) {
    const element = document.querySelector<HTMLElement>(selector); if (element) element.inert = inert;
  }
}
/** Awaitable save barrier, reusable by future IDE-managed writing tasks. */
async function flushBuffers(): Promise<boolean> {
  const results = await Promise.all([...buffers.values()].map(buffer => buffer.autosave?.flush() ?? true));
  return results.every(Boolean);
}
async function prepareDeparture(): Promise<boolean> {
  for (const buffer of buffers.values()) buffer.autosave?.pause();
  await flushBuffers();
  for (const [file, buffer] of buffers) {
    if (isDirty(buffer) && await confirmCloseTab(file) === 'cancel') return false;
  }
  // Explicit discard is permission to leave, not an immediate buffer mutation: a cancelled picker keeps edits.
  api.setDirty(false);
  return true;
}
function resumeAutosave() {
  for (const buffer of buffers.values()) buffer.autosave?.resume();
  updateDirty();
}
async function reload() {
  if (!current || closingTab || projectOpening || departing) return;
  const file = current;
  const buffer = buffers.get(file)!;
  closingTab = true; freezeWorkspace(true);
  try {
    await buffer.autosave?.settle();
    if (isDirty(buffer) && !(await confirmDiscard('Reload from disk?', 'This replaces your pending edits with the current file on disk.'))) return;
    const project = projectRevision;
    const document = await api.readDocument(file);
    if (project !== projectRevision || buffers.get(file) !== buffer) return;
    buffer.autosave?.dispose(); invalidateIndex();
    buffers.set(file, createBuffer(document));
    if (workspace && isMarkdown(file)) workspace.documents[file] = document.text;
    await openDocument(file); requestIndex();
  } finally {
    closingTab = false; freezeWorkspace(false); if (buffers.get(file) === buffer) buffer.autosave?.resume();
  }
}
async function refresh() {
  if (!workspace || projectOpening || closingTab || departing) return;
  if (refreshing) { refreshAgain = true; return; }
  refreshing = true;
  $<HTMLButtonElement>('#project-config-open').disabled = true;
  markdownSearch?.update();
  const project = projectRevision;
  try {
    const next = await api.refreshWorkspace();
    if (project !== projectRevision || projectOpening || closingTab || departing) return;
    workspace = next;
    invalidateIndex();
    for (const [file, buffer] of buffers) {
      try {
        const version = buffer.version;
        const disk = await api.readDocument(file);
        if (project !== projectRevision || projectOpening || closingTab || departing) return;
        if (buffers.get(file) !== buffer || buffer.autosave?.saving || buffer.version !== version) continue;
        if (disk.version === buffer.version) continue;
        if (isDirty(buffer)) { buffer.conflict = 'This file changed on disk. Your pending edits are preserved. Reload to discard them, or copy them before reconciling.'; buffer.autosave?.block(buffer.conflict); continue; }
        buffer.autosave?.dispose();
        const refreshed = createBuffer(disk); buffers.set(file, refreshed);
        if (current === file) { updating = true; editor.setState(refreshed.state); updating = false; renderPreview(); }
      } catch { buffer.conflict = 'This file is unavailable on disk. Your open buffer is preserved.'; buffer.autosave?.block(buffer.conflict); }
    }
    updateDirty(); renderFiles(); renderWarnings(); requestIndex();
  } finally {
    refreshing = false;
    $<HTMLButtonElement>('#project-config-open').disabled = !workspace;
    markdownSearch?.update(); if (refreshAgain) { refreshAgain = false; run(refresh); } projectConfiguration?.update();
  }
}
function renderWarnings() {
  const warnings = [...(workspace?.warnings ?? []), ...(!indexReady && indexNotice !== 'Updating the Markdown index...' ? [indexNotice] : [])];
  $('#warnings').textContent = warnings.join('\n');
  $('#warnings').hidden = !warnings.length;
}
function invalidateIndex() {
  worker.cancel();
  revision++;
  indexReady = false;
  $('#preview').querySelectorAll<HTMLButtonElement>('.id-link').forEach(button => { button.disabled = true; });
  indexNotice = 'Updating the Markdown index...';
  publishViewSnapshot();
  renderReferencePanel();
}
function requestIndex() {
  if (!workspace) return;
  const documents = currentMarkdownDocuments();
  invalidateIndex();
  pendingIndexDocuments = documents;
  worker.run({ revision, documents, configuration: workspace.idConfiguration?.configuration, configurationRevision: workspace.idConfiguration?.revision });
  setStatus('Indexing Markdown…');
}
function receiveIndex(result: IndexResponse) {
  if (result.revision !== revision) return;
  if (result.error) {
    indexNotice = result.error;
    index = { definitions: [], references: [], findings: [], diagrams: [] };
    publishViewSnapshot(); renderFiles(); renderLens(); renderReferencePanel(); renderWarnings(); renderPreview();
    for (const selector of ['#metric-ids', '#metric-pending', '#issue-count']) $(selector).textContent = '—';
    setStatus('Index unavailable'); notify(result.error); return;
  }
  index = result.index!;
  indexReady = true;
  $('#preview').querySelectorAll<HTMLButtonElement>('.id-link').forEach(button => { button.disabled = false; });
  indexDocuments = pendingIndexDocuments;
  publishViewSnapshot();
  $('#metric-docs').textContent = String(Object.keys(workspace?.documents ?? {}).length);
  $('#metric-ids').textContent = String(index.definitions.length);
  $('#metric-pending').textContent = String(index.findings.filter(item => item.kind === 'pending').length);
  $('#issue-count').textContent = String(index.findings.length);
  renderFiles(); renderLens(); renderWarnings();
  renderReferencePanel();
  if (viewMode === 'preview' && renderedIds !== occurrenceSignature()) renderPreview();
  const count = index.diagrams.filter(item => item.file === current).length;
  $('#diagram-count').textContent = String(count);
  if (viewMode === 'diagrams' && (renderedFile !== current || renderedMarkdown !== editor.state.doc.toString())) renderPreview();
  setStatus(`${workspace?.name} · Index up to date${[...buffers.values()].some(isDirty) ? ' · includes unsaved edits' : ''}`);
}
function focusModuleCard() {
  if (!moduleFocus || !indexReady) return;
  const pending = moduleFocus; moduleFocus = undefined;
  if (pending.project !== projectRevision) return;
  const control = [...document.querySelectorAll<HTMLButtonElement>('.lens-card-actions button')].find(button => button.getAttribute('aria-label') === `Edit ${pending.dimension ?? 'modules'} for ${keyLabel(pending.id)}`);
  const group = control?.closest<HTMLDetailsElement>('.lens-group'); if (group) group.open = true;
  (control ?? $<HTMLSelectElement>('#module-filter')).focus();
}
function renderLens() {
  const restoreFocus = captureLensFocus($('#lens-results'));
  // Configuration saves can trigger both an explicit refresh and a filesystem refresh.
  // Keep the selected scoped card focused when the latter replaces its DOM again.
  const active = document.activeElement as HTMLElement | null;
  const focusedCard = ['Edit modules for ', 'Edit features for '].some(prefix => active?.getAttribute('aria-label')?.startsWith(prefix)) ? active?.closest<HTMLElement>('.lens-card')?.dataset.id : undefined;
  if (focusedCard && !active?.closest('.lens-group')) moduleFocus = { id: focusedCard, project: projectRevision, dimension: active?.getAttribute('aria-label')?.startsWith('Edit features') ? 'features' : 'modules' };
  const moduleFilter = $<HTMLSelectElement>('#module-filter'), selectedModule = moduleFilter.value;
  const configuration = workspace?.idConfiguration?.configuration;
  moduleFilter.replaceChildren(...[['', 'All modules'], ['@unassigned', 'Unassigned'], ['@conflict', 'Module conflicts'], ...(configuration?.modules ?? []).map(module => [module.key, module.name])].map(([value, label]) => new Option(label, value)));
  moduleFilter.value = [...moduleFilter.options].some(option => option.value === selectedModule) ? selectedModule : '';
  $('#module-filter-row').hidden = lensMode !== 'index' || !configuration || (configuration.modules === undefined && configuration.moduleRules === undefined && configuration.moduleOverrides === undefined);
  $('#lens-grouping-row').hidden = lensMode !== 'index';
  const grouping = lensMode === 'index' ? $<HTMLSelectElement>('#lens-grouping').value as LensGrouping : 'none';
  const indexedRevision = revision;
  const parent = $('#lens-results'); parent.replaceChildren();
  const query = $<HTMLInputElement>('#id-search').value.toLowerCase();
  const items: (Occurrence | Finding)[] = lensMode === 'index' ? index.definitions : index.findings;
  $('#lens-heading').textContent = lensMode === 'index' ? 'DEFINITIONS' : 'PENDING ITEMS & ID ISSUES';
  $('#index-tab').classList.toggle('selected', lensMode === 'index'); $('#pending-tab').classList.toggle('selected', lensMode === 'issues');
  const moduleItems = items.filter(item => {
    if (lensMode !== 'index' || !moduleFilter.value) return true;
    const assignment = 'moduleAssignment' in item ? item.moduleAssignment : undefined;
    return moduleFilter.value === '@unassigned' ? !assignment || assignment.state === 'unassigned' : moduleFilter.value === '@conflict' ? assignment?.state === 'conflict' : assignment?.state === 'assigned' && assignment.modules.some(module => module.key === moduleFilter.value);
  });
  const filtered = moduleItems.filter(item => `${item.file} ${'id' in item && item.kind === 'definition' ? idLabel(item) + ' ' + item.label : ('message' in item ? item.message : item.label)}`.toLowerCase().includes(query));
  const renderCard = (item: Occurrence | Finding): HTMLElement => {
    const row = button('', 'lens-row', () => run(() => openDocument(item.file, item, undefined, indexedRevision)));
    const title = document.createElement('strong'); title.textContent = 'id' in item && item.kind === 'definition' ? idLabel(item) : item.kind === 'pending' ? 'Pending' : item.kind === 'duplicate' ? 'Duplicate ID' : item.kind === 'module-conflict' ? 'Module conflict' : item.kind === 'feature-conflict' ? 'Feature conflict' : 'Unresolved ID';
    if (item.kind !== 'definition') title.className = item.kind === 'pending' ? 'amber' : 'coral';
    const label = document.createElement('span'); label.textContent = 'id' in item && item.kind === 'definition' ? item.label.replace(item.id, '').replace(/^\s*[—–:-]\s*/, '').slice(0, 150) : ('message' in item ? item.message : item.label).slice(0, 150);
    const source = document.createElement('small'); source.textContent = `${item.file}:${item.line}`;
    row.append(title, label, source);
    if ('id' in item && item.kind === 'definition') {
      const card = document.createElement('div'); card.className = 'lens-card'; card.dataset.id = idKey(item);
      card.dataset.source = JSON.stringify([idKey(item), item.file, item.offset]);
      if (item.category) {
        styleCategoryCard(card, item.category);
        const category = document.createElement('span'); category.className = 'lens-category'; category.textContent = item.category.name; row.prepend(category);
      }
      const actions = document.createElement('div'); actions.className = 'lens-card-actions';
      const occurrences = button('All occurrences', 'quiet-button', () => showReferences(idKey(item)));
      occurrences.setAttribute('aria-label', `All occurrences of ${idLabel(item)}`); actions.append(occurrences);
      if (supportsRelationships(idKey(item), index) && hasView(FOCUS_VIEW)) {
        const relationships = button('Relationships', 'quiet-button', () => showRelationships(idKey(item)));
        relationships.setAttribute('aria-label', `Relationships for ${idLabel(item)}`); actions.append(relationships);
        const map = button('Explore map', 'quiet-button', () => activateMap(idKey(item)));
        map.setAttribute('aria-label', `Explore map for ${idLabel(item)}`); actions.append(map);
      }
      const editModules = button('Edit modules', 'quiet-button', () => {
        if (!indexReady || revision !== indexedRevision) { notify('The index changed. Reopen Edit modules from the current card.'); return; }
        moduleAssignmentEditor!.show(idKey(item));
      });
      editModules.setAttribute('aria-label', `Edit modules for ${idLabel(item)}`); actions.append(editModules);
      const editFeatures = button('Edit features', 'quiet-button', () => {
        if (!indexReady || revision !== indexedRevision) { notify('The index changed. Reopen Edit features from the current card.'); return; }
        featureAssignmentEditor!.show(idKey(item));
      });
      editFeatures.setAttribute('aria-label', `Edit features for ${idLabel(item)}`); actions.append(editFeatures);
      if (item.authoredStatus) { row.append(statusBadge(item.authoredStatus.evidence[0].display ?? item.authoredStatus.evidence[0].value, configuration?.statuses ?? [], item.authoredStatus.state === 'conflict')); }
      if (item.featureAssignment) row.append(featureBadges(item.featureAssignment));
      if (item.moduleAssignment) row.append(moduleBadges(item.moduleAssignment));
      card.append(row, actions);
      if (item.authoredStatus) card.append(statusEvidence(item, configuration?.statuses ?? [], source => run(() => openDocument(source.file, source, undefined, indexedRevision))));
      if (item.featureAssignment) card.append(featureEvidence(item.featureAssignment, source => run(() => openDocument(source.file, source, undefined, indexedRevision)), item.scope));
      if (item.moduleAssignment) card.append(moduleEvidence(item.moduleAssignment, source => run(() => openDocument(source.file, source, undefined, indexedRevision)), item.scope));
      return card;
    } else return row;
  };
  if (grouping === 'none') parent.append(...filtered.slice(0, 250).map(renderCard));
  else {
    const definitions = filtered as Occurrence[];
    const total = document.createElement('p'); total.className = 'empty-hint lens-group-total';
    const count = new Set(definitions.map(idKey)).size;
    total.textContent = `${count} distinct ${count === 1 ? 'ID' : 'IDs'} matching filters.${grouping === 'status' ? ' Statuses are authored, not verified progress.' : ` IDs in multiple ${grouping}s appear in each group.`}`;
    parent.append(total);
    lensGroups.render(parent, grouping, groupDefinitions(definitions, grouping), renderCard);
  }
  if (!filtered.length) { const empty = document.createElement('p'); empty.className = 'empty-hint'; empty.textContent = !indexReady ? indexNotice : query || (lensMode === 'index' && moduleFilter.value) ? 'No matching items.' : lensMode === 'index' ? 'Define an ID in a heading or an ID table column.' : 'No pending items or ID issues found.'; parent.append(empty); }
  if (grouping === 'none' && filtered.length > 250) { const more = document.createElement('p'); more.className = 'empty-hint'; more.textContent = `Showing 250 of ${filtered.length}. Use search to narrow the list.`; parent.append(more); }
  focusModuleCard();
  restoreFocus?.();
}
async function navigateId(id: string) {
  if (!indexReady) { notify(indexNotice); return; }
  const indexedRevision = revision;
  const definitions = index.definitions.filter(item => idKey(item) === id);
  if (definitions.length === 1) { await openDocument(definitions[0].file, definitions[0], undefined, indexedRevision); showReferences(id); }
  else if (definitions.length > 1) { showReferences(id); notify(`${keyLabel(id)} has ${definitions.length} definitions. Choose one in the references panel.`); }
  else { showReferences(id); notify(`No definition found for ${keyLabel(id)}.`); }
}
function showRelationships(id: string) {
  if (referencesFor !== id || referenceMode !== 'relationships') expandedRelationships.clear();
  referencesFor = id; referenceMode = 'relationships'; renderReferencePanel();
}
function showReferences(id: string) {
  referencesFor = id; referenceMode = 'occurrences'; renderReferencePanel();
}
function renderReferencePanel() {
  if (!referencesFor) return;
  const id = referencesFor;
  if (referenceMode === 'relationships') { renderRelationships(id); return; }
  $('#references-panel').classList.remove('showing-relationships');
  const parent = $('#references-results'); parent.replaceChildren();
  const mentions = [...index.definitions, ...index.references].filter(item => idKey(item) === id);
  $('#references-panel').hidden = false;
  $('#references-title').textContent = `${keyLabel(id)} · ${mentions.filter(item => item.kind === 'reference').length} references`;
  if (!indexReady) { parent.textContent = indexNotice; return; }
  const indexedRevision = revision;
  for (const item of mentions) {
    const row = button(`${item.kind === 'definition' ? '◆' : '↗'} ${item.file}:${item.line}`, 'reference-row', () => run(() => openDocument(item.file, item, undefined, indexedRevision)));
    row.title = item.label; parent.append(row);
  }
  if (!mentions.length) parent.textContent = 'No indexed occurrences.';
}
function renderRelationships(id: string) {
  const parent = $('#references-results'); parent.replaceChildren();
  $('#references-panel').hidden = false;
  $('#references-panel').classList.add('showing-relationships');
  $('#references-title').textContent = `${keyLabel(id)} relationships`;
  const note = document.createElement('p'); note.className = 'relationship-note';
  note.textContent = 'Requirement/design and design/task references within defining sections and ID rows. References do not establish implementation or coverage.';
  parent.append(note, button('All occurrences', 'quiet-button', () => showReferences(id)));
  if (hasView(FOCUS_VIEW)) parent.append(button('Explore map', 'quiet-button', () => activateMap(id)));
  if (!indexReady) { const status = document.createElement('p'); status.className = 'relationship-note'; status.textContent = indexNotice; parent.append(status); return; }
  const indexedRevision = revision;
  const result = relationshipsFor(index, id);
  if (result.definitionCount !== 1) {
    const warning = document.createElement('p'); warning.className = 'relationship-note coral';
    warning.textContent = result.definitionCount ? `${keyLabel(id)} has ${result.definitionCount} definitions. These references are ambiguous; use All occurrences to inspect them.` : `No definition found for ${keyLabel(id)}. These references are unresolved.`;
    parent.append(warning);
  }
  if (!result.groups.length) {
    const empty = document.createElement('p'); empty.className = 'relationship-note';
    empty.textContent = 'No owned requirement/design or design/task references found. Other mentions are available under All occurrences.'; parent.append(empty);
  }
  for (const group of result.groups) {
    const details = document.createElement('details'); details.className = 'relationship-group'; details.dataset.id = group.id;
    details.open = expandedRelationships.has(group.id);
    details.ontoggle = () => { if (details.isConnected) { if (details.open) expandedRelationships.add(group.id); else expandedRelationships.delete(group.id); } };
    const summary = document.createElement('summary');
    const incoming = group.evidence.some(item => item.to === id), outgoing = group.evidence.some(item => item.from === id);
    const direction = incoming && outgoing ? 'references in both directions' : incoming ? `references ${keyLabel(id)}` : `referenced by ${keyLabel(id)}`;
    summary.textContent = `${keyLabel(group.id)} · ${direction} · ${group.evidence.length} mention${group.evidence.length === 1 ? '' : 's'}`;
    details.append(summary);
    if (result.definitionCount !== 1 || group.definitionCount !== 1) {
      const warning = document.createElement('p'); warning.className = 'relationship-note coral';
      warning.textContent = group.definitionCount === 0 ? `Missing definition: ${keyLabel(group.id)}.` : group.definitionCount > 1 ? `${keyLabel(group.id)} has ${group.definitionCount} definitions; no target chosen.` : `The selected ID ${keyLabel(id)} is missing or ambiguous; this is not a resolved relationship.`;
      details.append(warning);
    }
    if (group.definition) {
      const target = group.definition;
      details.append(button(`Open ${keyLabel(group.id)} definition`, 'reference-row relationship-definition', () => run(() => openDocument(target.file, target, undefined, indexedRevision))));
    }
    for (const evidence of group.evidence) {
      const source = evidence.reference;
      const entry = button(`${keyLabel(evidence.from)} references ${keyLabel(evidence.to)}\n${source.file}:${source.line}\n${source.label}`, 'reference-row relationship-evidence', () => run(() => openDocument(source.file, source, undefined, indexedRevision)));
      entry.title = `Open evidence in ${source.file} at line ${source.line}`;
      details.append(entry);
    }
    parent.append(details);
  }
}
function renderPreview() {
  const target = $('#preview');
  previewGeneration++;
  previewRendering = Promise.resolve();
  renderedFile = current;
  $('#diagram-count').textContent = '0';
  if (!current) { target.replaceChildren(); return; }
  const buffer = buffers.get(current)!;
  if (!isMarkdown(current)) { target.replaceChildren(); const hint = document.createElement('p'); hint.className = 'empty-hint'; hint.textContent = 'Code is available for exploration. Open a Markdown file to see its preview and diagrams.'; target.append(hint); return; }
  renderedMarkdown = buffer.state.doc.toString();
  const diagrams = markdownDiagrams(renderedMarkdown);
  $('#diagram-count').textContent = String(diagrams.length);
  const rendering: Promise<void>[] = [];
  const scroll = target.scrollTop;
  if (viewMode === 'diagrams') {
    target.replaceChildren();
    if (!diagrams.length) { const hint = document.createElement('p'); hint.className = 'empty-hint'; hint.textContent = 'Mermaid blocks in this document appear here, with a link back to their source.'; target.append(hint); }
    for (const [i, diagram] of diagrams.entries()) {
      const card = document.createElement('section'); card.className = 'diagram-card';
      card.dataset.sourceStart = String(diagram.offset); card.dataset.sourceEnd = String(diagram.end);
      const header = document.createElement('div'); header.className = 'diagram-heading'; header.textContent = `DIAGRAM ${i + 1}`;
      const file = current;
      header.append(button(`Source · line ${diagram.line} ↗`, 'quiet-button', () => run(() => openDocument(file, { ...diagram, file }))));
      const canvas = document.createElement('div'); canvas.className = 'diagram-canvas'; canvas.textContent = 'Rendering diagram…';
      card.append(header, canvas); target.append(card); rendering.push(renderDiagram(canvas, diagram.source));
    }
  } else {
    renderedIds = occurrenceSignature();
    renderMarkdown(target, renderedMarkdown, currentOccurrences());
    for (const code of target.querySelectorAll<HTMLElement>('pre > code.language-mermaid')) {
      const canvas = document.createElement('div'); canvas.className = 'diagram-canvas'; canvas.textContent = 'Rendering diagram…';
      canvas.dataset.sourceStart = code.parentElement!.dataset.sourceStart;
      canvas.dataset.sourceEnd = code.parentElement!.dataset.sourceEnd;
      const source = code.textContent ?? ''; code.parentElement!.replaceWith(canvas); rendering.push(renderDiagram(canvas, source));
    }
  }
  target.scrollTop = scroll;
  previewRendering = Promise.all(rendering).then(() => {});
}

async function showInPreview() {
  if (!current || !isMarkdown(current)) return;
  const file = current, text = editor.state.doc.toString(), position = visibleSourcePosition(editor);
  if (viewMode !== 'preview') {
    viewMode = 'preview';
    for (const mode of ['preview', 'diagrams']) { $(`#${mode}-tab`).classList.toggle('selected', mode === viewMode); $(`#${mode}-tab`).setAttribute('aria-pressed', String(mode === viewMode)); }
    renderPreview();
  } else if (renderedFile !== file || renderedMarkdown !== text) renderPreview();
  const generation = previewGeneration;
  await previewRendering;
  if (current !== file || editor.state.doc.toString() !== text || previewGeneration !== generation) return;
  const block = blockAtSource($('#preview'), position);
  if (block) revealPreviewBlock($('#preview'), block);
  else notify('There is no rendered Markdown block to show.');
}

function showInSource() {
  if (!current || !isMarkdown(current)) return;
  if (renderedFile !== current || renderedMarkdown !== editor.state.doc.toString()) {
    renderPreview(); notify('The preview was refreshed after an edit. Choose Show in source again at the passage you want.'); return;
  }
  const block = visiblePreviewBlock($('#preview'));
  if (!block) { notify('There is no rendered Markdown block to show in the source.'); return; }
  const position = Math.min(editor.state.doc.length, blockSourcePosition(block));
  const wasHidden = sourceHidden;
  if (wasHidden) setSourceHidden(false);
  editor.dispatch({ ...(wasHidden ? { selection: { anchor: position } } : {}), effects: EditorView.scrollIntoView(position, { y: 'start', yMargin: 12 }) });
  if (wasHidden) editor.focus();
}

const recents = new RecentProjectsView($('#welcome-recent'), api, root => run(() => switchProject(() => api.openRecent(root))));
const agentSetup = new AgentSetup(api);
async function switchProject(task: () => Promise<WorkspaceOpenResult>) {
  if (projectOpening || closingTab || departing) return;
  const savedSession = persistWorkspaceSession();
  let settled!: () => void;
  projectSettled = new Promise<void>(resolve => { settled = resolve; });
  projectOpening = true;
  markdownSearch?.update();
  const surfaces = [$('#workspace'), $('#welcome'), $('.topbar'), $('#recent-projects-dialog')];
  const recentDialog = $<HTMLDialogElement>('#recent-projects-dialog');
  recentDialog.oncancel = event => event.preventDefault();
  surfaces.forEach(element => { element.inert = true; });
  try {
    if (!(await prepareDeparture())) return;
    await savedSession;
    const result = await task();
    if (!result.ok) notify(result.message);
    else if (result.workspace) { recents.close(); await useWorkspace(result.workspace); }
    await recents.refresh();
    if (!result.ok && recentDialog.open) recents.showError(result.message);
  } finally {
    surfaces.forEach(element => { element.inert = false; });
    recentDialog.oncancel = null; projectOpening = false;
    resumeAutosave();
    markdownSearch?.update();
    await persistWorkspaceSession();
    settled();
  }
}
const openProject = () => run(() => switchProject(() => api.chooseWorkspace()));
$('#open-project').onclick = openProject; $('#welcome-open').onclick = openProject;
$('#show-recent').onclick = () => recents.show();
$('#show-agent-setup').onclick = () => agentSetup.show();
const conversationPanel = new ConversationPanel(api, () => agentSetup.show());
const terminalPanel = new TerminalPanel(api, kind => $<HTMLInputElement>(`#${kind}-path`).value,
  () => { if (current) editor.focus(); else $('#show-terminals').focus(); });
$('#show-terminals').onclick = () => terminalPanel.toggle();
$('#show-conversation').onclick = () => { void conversationPanel.show(); };
$('#open-demo').onclick = () => run(() => switchProject(() => api.openDemo()));
$('#refresh').onclick = () => run(refresh); $('#retry-save').onclick = () => run(save); $('#reload').onclick = () => run(reload);
$('#follow-id').onclick = () => followCursor(false);
$('#prepare-brief').onclick = prepareBrief;
$('#new-file').onclick = newMarkdownFile;
// Preserve the browser's preview selection until the click handler captures both panels.
$('#prepare-brief').onmousedown = event => event.preventDefault();
for (const id of ['show-in-preview', 'show-in-source']) $('#' + id).onmousedown = event => {
  event.preventDefault();
  const selection = window.getSelection();
  const anchor = selection?.anchorNode, focus = selection?.focusNode;
  const anchorOffset = selection?.anchorOffset ?? 0, focusOffset = selection?.focusOffset ?? 0;
  // Blurring CodeMirror prevents its viewport update from restoring the browser selection over a preview selection.
  $('#' + id).focus({ preventScroll: true });
  if (anchor?.isConnected && focus?.isConnected) selection?.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset);
};
$('#show-in-preview').onclick = () => run(showInPreview);
$('#show-in-source').onclick = showInSource;
$('#file-search').oninput = renderFiles; $('#id-search').oninput = renderLens;
$('#index-tab').onclick = () => { lensMode = 'index'; renderLens(); };
$('#pending-tab').onclick = () => { lensMode = 'issues'; renderLens(); };
$('#dependency-overview-open').onclick = activateOverview;
function pluginGroup(id: string) { return `plugin:${id}`; }
function pluginSignature(plugin: InstalledPluginInfo) { return JSON.stringify([plugin.manifest, plugin.origin, plugin.revision]); }
function renderPluginManager(plugins: InstalledPluginInfo[]) {
  const list = $('#plugin-manager-list'); list.replaceChildren(); $('#plugin-manager-empty').hidden = plugins.length > 0;
  for (const plugin of plugins) {
    const row = document.createElement('article'); row.className = 'plugin-manager-item';
    const heading = document.createElement('div'); heading.className = 'plugin-manager-heading';
    const name = document.createElement('strong'); name.textContent = plugin.manifest.id;
    const version = document.createElement('span'); version.textContent = `v${plugin.manifest.version}${plugin.bundledVersion ? ` · ${plugin.origin === 'bundled' ? 'Bundled' : 'Installed replacement'} · bundled v${plugin.bundledVersion}` : ''}`; heading.append(name, version);
    const details = document.createElement('p'); details.textContent = plugin.status === 'invalid' ? plugin.message ?? 'Invalid package' : `${plugin.manifest.views.length} view(s) · ${plugin.manifest.capabilities.join(', ')}`;
    const actions = document.createElement('div'); actions.className = 'plugin-manager-item-actions';
    if (plugin.status === 'ready') {
      if (plugin.enabled) actions.append(button('Open', 'quiet-button', () => { const entry = registeredPlugins.get(plugin.manifest.id); if (entry) { $<HTMLDialogElement>('#plugin-manager-dialog').close(); viewHost.openView(entry.view); } }));
      actions.append(button(plugin.enabled ? 'Disable' : 'Enable', 'quiet-button', () => run(async () => { await api.setPluginEnabled(plugin.manifest.id, !plugin.enabled); await syncPlugins(); })));
    }
    if (plugin.bundledVersion) actions.append(button('Restore bundled version', 'quiet-button', () => run(async () => { await api.restoreBundledPlugin(plugin.manifest.id); await syncPlugins(); })));
    else actions.append(button('Uninstall', 'quiet-button coral', () => run(async () => { await api.uninstallPlugin(plugin.manifest.id); await syncPlugins(); })));
    row.append(heading, details, actions); list.append(row);
  }
}
async function syncPlugins(openId?: string) {
  const plugins = await api.pluginList();
  const enabled = new Map(plugins.filter(plugin => plugin.enabled && plugin.status === 'ready').map(plugin => [plugin.manifest.id, plugin]));
  for (const [id, registered] of registeredPlugins) {
    const plugin = enabled.get(id);
    if (!plugin || pluginSignature(plugin) !== registered.signature) { viewHost.remove(pluginGroup(id)); viewRegistry.unregisterGroup(pluginGroup(id)); registeredPlugins.delete(id); }
  }
  for (const plugin of plugins) if (plugin.enabled && plugin.status === 'ready') {
    if (!registeredPlugins.has(plugin.manifest.id)) registeredPlugins.set(plugin.manifest.id, { view: registerPluginViews(viewRegistry, plugin.manifest), signature: pluginSignature(plugin) });
  }
  $('#loaded-plugin-views').replaceChildren();
  for (const plugin of plugins) if (plugin.enabled && plugin.status === 'ready') {
    const id = registeredPlugins.get(plugin.manifest.id)!.view, open = button(plugin.manifest.title ?? plugin.manifest.views[0].title, 'quiet-button', () => viewHost.openView(id));
    open.dataset.pluginId = plugin.manifest.id; $('#loaded-plugin-views').append(open);
  }
  renderPluginManager(plugins);
  $<HTMLButtonElement>('#dependency-overview-open').disabled = !enabled.get('specular.relationships')?.manifest.views.some(v => v.id === 'overview');
  renderLens();
  renderReferencePanel();
  if (openId && registeredPlugins.has(openId)) viewHost.openView(registeredPlugins.get(openId)!.view);
}
$('#plugin-view-open').onclick = () => run(async () => {
  const manifest = await api.choosePlugin();
  if (manifest) { await syncPlugins(manifest.id); notify(`Installed ${manifest.id} ${manifest.version}.`); }
});
$('#plugin-manager-open').onclick = () => run(async () => { viewHost.showDocument(); await syncPlugins(); $<HTMLDialogElement>('#plugin-manager-dialog').showModal(); });
$('#plugin-manager-close').onclick = () => $<HTMLDialogElement>('#plugin-manager-dialog').close();
$('#plugin-install-folder').onclick = () => run(async () => { const manifest = await api.choosePlugin(); if (manifest) { await syncPlugins(); notify(`Installed ${manifest.id} ${manifest.version}.`); } });
$('#plugin-install-archive').onclick = () => run(async () => { const manifest = await api.installPluginArchive(); if (manifest) { await syncPlugins(); notify(`Installed ${manifest.id} ${manifest.version}.`); } });
$('#close-references').onclick = () => { referencesFor = undefined; $('#references-panel').hidden = true; };
for (const mode of ['preview', 'diagrams'] as const) $(`#${mode}-tab`).onclick = () => {
  viewMode = mode;
  for (const value of ['preview', 'diagrams']) { $(`#${value}-tab`).classList.toggle('selected', value === mode); $(`#${value}-tab`).setAttribute('aria-pressed', String(value === mode)); }
  renderPreview();
};
$('#preview').onclick = event => {
  if (current && capturePreviewSelection($('#preview'), current, false, false)) { event.preventDefault(); return; }
  const element = (event.target as Element).closest<HTMLElement>('[data-id], a');
  if (!element || !current) return;
  event.preventDefault();
  if (element.dataset.id) { if (event.shiftKey) showReferences(element.dataset.id); else run(() => navigateId(element.dataset.id!)); return; }
  const from = current;
  run(async () => { const link = await api.resolveLink(from, element.getAttribute('href') ?? ''); await openDocument(link.path, undefined, link.anchor); });
};
markdownSearch = new MarkdownSearchPanel($('.explorer'), $<HTMLButtonElement>('#markdown-search-open'), () => ({
  projectId: workspaceProjectId(), currentFile: viewHost.activeGroup ? undefined : current,
  documents: currentMarkdownDocuments(), busy: projectOpening || refreshing,
  warnings: [...(workspace?.warnings ?? []), ...[...buffers.values()].filter(buffer => isMarkdown(buffer.path) && buffer.conflict)
    .map(buffer => `${buffer.path}: ${buffer.conflict}`)],
}), (match, text, valid) => openDocument(match.file, match, undefined, undefined,
  { text, valid: () => valid() && !projectOpening && !refreshing }));
function showMarkdownSearch(scope: SearchScope) {
  if (!workspace || projectOpening || closingTab || document.querySelector('dialog[open]')) return;
  markdownSearch!.show(scope);
}
// Capture before CodeMirror's built-in find handler; terminal and dialog input keep their own shortcuts.
document.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'f' ||
    !(event.target instanceof Element) || !event.target.closest('#workspace') || projectOpening || closingTab || document.querySelector('dialog[open]')) return;
  if (!event.shiftKey && (!current || !isMarkdown(current) || viewHost.activeGroup)) return;
  event.preventDefault(); event.stopImmediatePropagation(); showMarkdownSearch(event.shiftKey ? 'project' : 'current');
}, true);
const configurationContext = () => workspace?.idConfiguration ? {
    root: workspace.root, projectId: workspaceProjectId(), state: workspace.idConfiguration,
    documents: currentMarkdownDocuments(), documentVersions: workspace.documentVersions ?? {},
    baseline: indexReady ? index : undefined, baselineNotice: indexReady ? undefined : indexNotice,
    warnings: [...workspace.warnings, ...[...buffers.values()].filter(buffer => isMarkdown(buffer.path) && buffer.conflict).map(buffer => `${buffer.path}: ${buffer.conflict}`)],
    busy: projectOpening || refreshing || closingTab || departing,
  } : undefined;
projectConfiguration = new ProjectConfigurationDialog({
  setupAgent: onClose => agentSetup.show(onClose),
  agentPath: kind => $<HTMLInputElement>(`#${kind}-path`).value,
  context: configurationContext,
  refresh,
  save: (root, configuration, diskVersion, documentVersions) => api.saveProjectConfiguration(root, configuration, diskVersion, documentVersions),
  source: (source, text, valid) => openDocument(source.file, source, undefined, undefined, { text, valid }),
  notify,
});
moduleAssignmentEditor = new ModuleAssignmentEditor({
  context: configurationContext, hasConfigurationDraft: () => projectConfiguration!.hasDraft(),
  configure: () => projectConfiguration!.show(), refresh,
  save: (root, configuration, diskVersion, documentVersions) => api.saveProjectConfiguration(root, configuration, diskVersion, documentVersions),
  notify, focus: id => {
    moduleFocus = { id, project: projectRevision }; focusModuleCard();
  },
});
featureAssignmentEditor = new FeatureAssignmentEditor({
  context: configurationContext, hasConfigurationDraft: () => projectConfiguration!.hasDraft(),
  configure: () => projectConfiguration!.show(), refresh,
  save: (root, configuration, diskVersion, documentVersions) => api.saveProjectConfiguration(root, configuration, diskVersion, documentVersions),
  notify, focus: id => {
    moduleFocus = { id, project: projectRevision, dimension: 'features' }; focusModuleCard();
  },
});
$('#module-filter').onchange = renderLens;
$('#lens-grouping').onchange = renderLens;
$('#project-config-open').onclick = () => projectConfiguration!.show();
api.onWorkspaceChanged(() => run(refresh));
// Also handle keys delivered directly to the renderer (including automated input).
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'n') {
    event.preventDefault(); newMarkdownFile(); return;
  }
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'w') return;
  event.preventDefault();
  if (!projectOpening && !closingTab && !departing && !document.querySelector('dialog[open]')) { if (viewHost.activeGroup) closeView(); else if (current) run(() => closeTab(current!)); }
});
api.onAction(action => {
  if (action === 'capture-before-close') {
    run(async () => {
      await projectSettled;
      if (closingTab || departing || document.querySelector('#close-tab-dialog[open], #confirm-dialog[open]')) { await api.cancelClose(); return; }
      for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) dialog.close();
      departing = true; freezeWorkspace(true);
      let closed = false;
      try {
        if (!(await prepareDeparture())) { await api.cancelClose(); return; }
        await persistWorkspaceSession(true); closed = await api.finishClose();
      } catch (error) { await api.cancelClose(); throw error; }
      finally { if (!closed) { departing = false; freezeWorkspace(false); resumeAutosave(); } }
    });
    return;
  }
  if (projectOpening || closingTab || departing || document.querySelector('dialog[open]')) return;
  if (action === 'recent-projects') recents.show();
  if (action === 'agent-setup') agentSetup.show();
  if (action === 'codex-conversation') void conversationPanel.show();
  if (action === 'terminals') terminalPanel.toggle();
  if (action.startsWith('recent:')) run(() => switchProject(() => api.openRecent(action.slice(7))));
  if (action === 'close-tab') { if (viewHost.activeGroup) { closeView(); return; } if (current) run(() => closeTab(current!)); return; }
  if (action === 'open') openProject();
  if (action === 'new-file') newMarkdownFile();
  if (viewHost.activeGroup && ['save', 'definition', 'references'].includes(action)) return;
  if (action === 'save') run(save);
  if (action === 'definition') followCursor(false);
  if (action === 'references') followCursor(true);
  if (action === 'search') { lensMode = 'index'; renderLens(); $('#id-search').focus(); }
  if (action === 'markdown-find') showMarkdownSearch('current');
  if (action === 'markdown-search') showMarkdownSearch('project');
});
const themeSwitch = $<HTMLButtonElement>('#theme-switch');
themeSwitch.addEventListener('mousedown', event => { if (event.button === 0) event.preventDefault(); });
themeSwitch.onclick = () => {
  const selection = window.getSelection();
  const previewRanges = selection?.rangeCount && $('#preview').contains(selection.anchorNode)
    ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  // CodeMirror otherwise writes its native selection while the preview owns it.
  // Blurring keeps the source state intact and lets a later source focus restore it.
  if (previewRanges.length) editor.contentDOM.blur();
  const next = currentAppearance().mode === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  const effect = themeCompartment.reconfigure(EditorView.theme({}, { dark: next === 'dark' }));
  for (const [file, buffer] of buffers) if (file !== current) buffer.state = buffer.state.update({ effects: effect }).state;
  editor.dispatch({ effects: effect });
  if (previewRanges.length && selection) { selection.removeAllRanges(); for (const range of previewRanges) selection.addRange(range); }
  void api.saveTheme(next).then(result => { if (!result.ok) notify(result.message ?? 'Appearance could not be saved.'); }).catch(() => notify('Appearance applies for this session but could not be saved.'));
};
run(async () => {
  try { applyTheme(await api.theme()); } catch { applyTheme('dark'); notify('Appearance could not be loaded. Using Dark mode.'); }
  editor.dispatch({ effects: themeCompartment.reconfigure(EditorView.theme({}, { dark: currentAppearance().mode === 'dark' })) });
  themeSwitch.disabled = false;
  await api.appearanceReady();
  await fontSizes.load(); await syncPlugins(); await switchProject(() => api.initialWorkspace()); });
