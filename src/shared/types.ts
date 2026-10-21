export interface SourceLocation {
  file: string;
  line: number;
  column: number;
  offset: number;
  end: number;
}

export interface ModuleAssignment {
  state: 'assigned' | 'unassigned' | 'conflict';
  modules: import('../core/module-configuration').ProjectModule[];
  evidence: { kind: 'file-rule' | 'id-override' | 'unassigned'; rule?: string; path?: string; scope?: 'file' | 'folder'; id?: string; source?: SourceLocation; modules: import('../core/module-configuration').ProjectModule[] }[];
}
export interface FeatureAssignment {
  explicit: boolean;
  state: 'assigned' | 'unassigned' | 'conflict';
  features: import('../core/features').ProjectFeature[];
  evidence: { kind: 'file-rule' | 'id-override' | 'unassigned'; rule?: string; path?: string; scope?: 'file' | 'folder'; id?: string; source?: SourceLocation; features: import('../core/features').ProjectFeature[] }[];
}
export interface Occurrence extends SourceLocation {
  /** Scope value: a folder or file path, or a captured `name:value` scope (85a); absent for project scope. */
  scope?: string;
  /** A named element (85a): identity ignores case, and its source range covers the name rather than a token. */
  named?: true;
  /** Increment 85b: a change record (a requirement under ADDED/MODIFIED/REMOVED/RENAMED, or a declared New/Modified capability). */
  delta?: 'added' | 'modified' | 'removed' | 'renamed' | 'new';
  /** Increment 85b: a backticked text that becomes a name reference only if it names a known element. */
  candidate?: true;
  /** Increment 85b: a record nested in a change record (a scenario of an ADDED requirement); kept only if its parent becomes a proposed definition. */
  deltaParent?: Occurrence;
  authoredStatus?: import('../core/statuses').AuthoredStatus;
  moduleAssignment?: ModuleAssignment;
  featureAssignment?: FeatureAssignment;
  category?: import('../core/id-configuration').IdCategory;
  id: string;
  kind: 'definition' | 'reference';
  label: string;
  /** Defining section or ID table row containing this reference, in the same file; for a nested definition (85a), its parent element. */
  owner?: { scope?: string; id: string; offset: number; /** 85b: the owning change's file, when it is not this file. */ file?: string };
}

export interface Finding extends SourceLocation {
  scope?: string;
  kind: 'pending' | 'duplicate' | 'unresolved' | 'module-conflict' | 'feature-conflict' | 'consistency';
  message: string;
}

export interface Diagram extends SourceLocation { source: string }
export interface DocumentModel {
  file: string;
  occurrences: Occurrence[];
  pending: Finding[];
  diagrams: Diagram[];
}
export interface ProjectIndex {
  configurationRevision?: string;
  definitions: Occurrence[];
  references: Occurrence[];
  findings: Finding[];
  diagrams: Diagram[];
  /** Dated entries found by the event date rule (increment 79). */
  events?: import('../core/dates').IndexedEvent[];
}
export interface ProjectFile { path: string; markdown: boolean; configuration: boolean }
export interface WorkspaceSnapshot {
  documentVersions?: Record<string, string>;
  idConfiguration?: import('../core/id-configuration').IdConfigurationState;
  root: string;
  name: string;
  files: ProjectFile[];
  folders: string[];
  documents: Record<string, string>;
  warnings: string[];
  session?: WorkspaceSession;
}
export interface WorkspaceSession { files: string[]; activeFile?: string }
export interface OpenDocument { path: string; text: string; version: string }
export interface RecentProject { path: string; name: string }
export interface RecentProjectsState { projects: RecentProject[]; warning?: string }
export interface InstalledPluginInfo {
  revision?: number;
  bundledVersion?: string;
  origin?: 'bundled' | 'installed';
  manifest: import('../../packages/plugin-api/src/index').PluginManifest;
  enabled: boolean;
  status: 'ready' | 'invalid';
  message?: string;
}
export type WorkspaceOpenResult = { ok: true; workspace: WorkspaceSnapshot | null } | { ok: false; message: string };
export type CreateDocumentResult =
  | { ok: true; document: OpenDocument }
  | { ok: false; message: string };
export type SaveResult =
  | { ok: true; document: OpenDocument }
  | { ok: false; reason: 'conflict'; message: string };

export type AgentId = 'codex' | 'claude';
export interface AgentCheckResult {
  agent: AgentId;
  status: 'detected' | 'missing' | 'invalid' | 'failed' | 'timeout';
  path?: string;
  version?: string;
  message: string;
}

export interface SpecularBridge {
  runAgentDiscovery(request: import('../core/discovery-run').AgentDiscoveryRequest): Promise<import('../core/discovery-run').DiscoveryRunResult>;
  cancelAgentDiscovery(requestId: string): Promise<void>;
  onAgentDiscoveryProgress(callback: (value: { requestId: string; message: string; kind: import('../core/discovery-run').ProgressKind }) => void): () => void;
  onPluginFailure(callback: (event: { id: string; message: string }) => void): () => void;
  onCustomPluginState(callback: (event: { id: string; viewId: string; requestId: string; state: string }) => void): () => void;
  onCustomPluginNavigate(callback: (event: { id: string; viewId: string; requestId: string; source: import('../../packages/plugin-api/src/index').SourceReference }) => void): () => void;
  choosePlugin(): Promise<import('./plugin-runtime').PluginManifest | null>;
  pluginList(): Promise<InstalledPluginInfo[]>;
  installPluginArchive(): Promise<import('./plugin-runtime').PluginManifest | null>;
  setPluginEnabled(id: string, enabled: boolean): Promise<InstalledPluginInfo[]>;
  uninstallPlugin(id: string): Promise<InstalledPluginInfo[]>;
  restoreBundledPlugin(id: string): Promise<InstalledPluginInfo[]>;
  renderPlugin(id: string, request: string): Promise<import('./plugin-runtime').RenderResult>;
  renderCustomPlugin(id: string, request: string, bounds: PluginBounds): Promise<void>;
  layoutCustomPlugin(id: string, bounds: PluginBounds): Promise<void>;
  stopPlugin(id: string): Promise<void>;
  terminalOpen(kind: TerminalKind, executable?: string): Promise<{ ok: boolean; terminal?: TerminalInfo; message?: string }>;
  terminalAttach(id: string): void;
  terminalInput(id: string, data: string): void;
  insertTerminalBrief(id: string, projectRoot: string, text: string): Promise<{ ok: boolean; message?: string }>;
  terminalResize(id: string, cols: number, rows: number): void;
  terminalAcknowledge(id: string, length: number): void;
  terminalClose(id: string): Promise<{ ok: boolean; message?: string }>;
  onTerminalEvent(callback: (event: TerminalEvent) => void): () => void;
  conversationState(): Promise<ConversationState>;
  resumeCodexConversation(): Promise<CodexSendResult>;
  freshCodexConversation(): Promise<CodexSendResult>;
  selectCodexModel(model: string): Promise<void>;
  codexModels(): Promise<{ models: CodexModel[]; message?: string }>;
  sendCodexMessage(text: string, model: string): Promise<CodexSendResult>;
  sendCodexBrief(root: string, text: string, model: string): Promise<CodexSendResult>;
  stopCodexTurn(): Promise<void>;
  useOpenProjectForCodex(): Promise<{ ok: boolean; message?: string }>;
  onConversationState(callback: (state: ConversationState) => void): () => void;
  codexStatus(): Promise<CodexConnectionState>;
  connectCodex(path: string, apiKey: string, remember?: boolean, autoConnect?: boolean): Promise<CodexConnectionState>;
  codexCredentials(): Promise<CodexCredentialState>;
  forgetCodexKey(): Promise<CodexCredentialState>;
  disconnectCodex(): Promise<CodexConnectionState>;
  onCodexState(callback: (state: CodexConnectionState) => void): () => void;
  checkAgent(agent: AgentId, path: string): Promise<AgentCheckResult>;
  chooseAgentPath(): Promise<string | null>;
  initialWorkspace(): Promise<WorkspaceOpenResult>;
  chooseWorkspace(): Promise<WorkspaceOpenResult>;
  openDemo(): Promise<WorkspaceOpenResult>;
  recentProjects(): Promise<RecentProjectsState>;
  theme(): Promise<import('./appearance').ThemeMode>;
  saveTheme(mode: import('./appearance').ThemeMode): Promise<{ ok: boolean; message?: string }>;
  appearanceReady(): Promise<void>;
  setCustomPluginsObscured(obscured: boolean): Promise<void>;
  fontSizes(): Promise<import('./font-sizes').FontSizes>;
  saveFontSizes(sizes: import('./font-sizes').FontSizes): Promise<{ ok: boolean; message?: string }>;
  openRecent(path: string): Promise<WorkspaceOpenResult>;
  removeRecent(path: string): Promise<RecentProjectsState>;
  clearRecent(): Promise<RecentProjectsState>;
  refreshWorkspace(): Promise<WorkspaceSnapshot>;
  saveProjectConfiguration(root: string, configuration: import('../core/id-configuration').IdConfiguration, diskVersion: string, documentVersions: Record<string, string>): Promise<{ ok: boolean; message?: string }>;
  saveWorkspaceSession(root: string, session: WorkspaceSession): Promise<{ ok: boolean; message?: string }>;
  finishClose(): Promise<boolean>;
  cancelClose(): Promise<void>;
  readDocument(path: string): Promise<OpenDocument>;
  createMarkdown(name: string): Promise<CreateDocumentResult>;
  saveDocument(path: string, text: string, version: string, project: string): Promise<SaveResult>;
  resolveLink(from: string, href: string): Promise<{ path: string; anchor: string }>;
  copyBrief(text: string): Promise<void>;
  setDirty(dirty: boolean): void;
  onWorkspaceChanged(callback: () => void): () => void;
  onAction(callback: (action: string) => void): () => void;
}

export interface PluginBounds { x: number; y: number; width: number; height: number }

declare global { interface Window { specular: SpecularBridge } }

export interface CodexCredentialState { remembered: boolean; autoConnect: boolean; executable: string; warning?: string }
export interface CodexConnectionState {
  status: 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error';
  message: string;
  path?: string;
  version?: string;
}

export interface CodexModel { id: string; label: string; isDefault: boolean }
export type TerminalKind = 'powershell' | 'cmd' | 'codex' | 'claude';
export interface TerminalInfo { id: string; kind: TerminalKind; root: string; status: 'running' | 'closing' | 'exited'; exitCode?: number }
export type TerminalEvent = { type: 'data'; id: string; data: string } | { type: 'state'; terminal: TerminalInfo };
export interface CodexSendResult { ok: boolean; message?: string; selectedModel?: string; models?: CodexModel[] }
export interface ConversationMessage { id: string; role: 'user' | 'assistant' | 'system'; text: string }
export interface ConversationState {
  selectedModel?: string;
  needsResume?: boolean;
  historyWarning?: string;
  historyEnabled?: boolean;
  commandBusy?: boolean;
  openProject?: string;
  projectPath?: string;
  scopeMismatch?: boolean;
  status: 'idle' | 'starting' | 'running' | 'stopping' | 'completed' | 'interrupted' | 'error';
  message: string;
  messages: ConversationMessage[];
}
