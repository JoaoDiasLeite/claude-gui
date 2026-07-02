export interface ToolCall {
  id: string
  tool: string
  input: unknown
  result?: string
  isError?: boolean
}

export interface MessageUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  costUsd: number
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  toolCalls?: ToolCall[]
  timestamp: number
  /** Set when this assistant turn ended in an error. */
  error?: boolean
  /** Token usage for this assistant turn (shown under the message). */
  usage?: MessageUsage
}

export interface Session {
  id: string
  name: string
  messages: Message[]
  projectPath?: string
  /** Claude Code engine session id, used to resume the conversation. */
  claudeSessionId?: string
  /** Model override for this session (falls back to the global default). */
  model?: string
  /** If launched from a CC Agent, the agent's run options. */
  agentId?: string
  agentName?: string
  systemPrompt?: string
  permissionMode?: PermissionMode
  allowedTools?: string[]
  useMcp?: boolean
  /** When true, skip per-tool approval prompts (auto-accept). */
  autoApprove?: boolean
  /** Light chat mode: send no tools (allowedTools:[]) to cut per-turn token cost. */
  lightMode?: boolean
  /** If set, this chat runs on a remote SSH host instead of locally. */
  remoteHostId?: string
  remoteHostName?: string
  /** If set, this chat runs inside this WSL distro. */
  wslDistro?: string
  /** Which Claude Code account (login) this chat runs under. Undefined = default account. */
  accountId?: string
  accountName?: string
  /** Accumulated usage across this chat's turns. */
  costUsd?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  createdAt: number
  updatedAt: number
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
}

export interface TermLine {
  kind: 'user' | 'thinking' | 'tool' | 'result' | 'error' | 'info'
  text: string
}

export interface ModelInfo {
  id: string
  label: string
  inputPrice: number
  outputPrice: number
  context: string
}

export interface UsageLimits {
  hourUsd: number
  sessionUsd: number
  weekUsd: number
}

export interface UiPrefs {
  theme: 'dark' | 'light'
  /** Color palette id (see global.css [data-palette]). 'warm-rust' is the default. */
  palette: string
  density: 'comfortable' | 'compact'
  fontSize: 'sm' | 'md' | 'lg'
  onboarded: boolean
}

export interface AppConfig {
  defaultModel: string
  limits: UsageLimits
  ui: UiPrefs
  claudeSettings: Record<string, unknown>
}

// ─── Scheduled Runs ─────────────────────────────────────────────────────────

export type ScheduledCadence =
  | { kind: 'interval'; everyMinutes: number }
  | { kind: 'daily'; time: string /* "HH:MM" */ }
  | { kind: 'weekly'; day: number /* 0=Sun..6=Sat */; time: string }

export interface ScheduledRun {
  id: string
  name: string
  prompt: string
  model?: string
  projectPath?: string
  accountId?: string
  cadence: ScheduledCadence
  enabled: boolean
  createdAt: number
  lastRunAt?: number
  lastResult?: { ok: boolean; summary: string; costUsd: number; at: number }
  nextRunAt?: number
  /**
   * Explicit tool-access level for this routine.
   * 'read-only' → mutating tools (Bash, Write, Edit, etc.) are removed from context via disallowedTools.
   * 'full'      → no tool restriction.
   * Undefined (legacy) → treated as 'full'.
   */
  toolAccess?: 'read-only' | 'full'
  /** @deprecated Use toolAccess. Kept to read legacy saved data. */
  allowedTools?: string[]
}

export interface SourceAccount {
  email?: string
  org?: string
  plan?: string
}

export interface SourceInfo {
  id: string
  label: string
  kind: 'local' | 'wsl'
  distro?: string
  account?: SourceAccount
}

export interface CCProject {
  encodedDir: string
  realPath: string
  name: string
  sessionCount: number
  lastActive: number
  sourceId: string
  sourceLabel: string
  kind: 'local' | 'wsl'
  distro?: string
  account?: SourceAccount
}

export interface CCSessionMeta {
  sessionId: string
  encodedDir: string
  realPath: string
  title: string
  preview: string
  messageCount: number
  model?: string
  createdAt: number
  updatedAt: number
  sourceId: string
  kind: 'local' | 'wsl'
  distro?: string
}

export interface SearchHit {
  sessionId: string
  encodedDir: string
  realPath: string
  projectName: string
  title: string
  snippet: string
  updatedAt: number
  model?: string
  sourceId: string
  kind: 'local' | 'wsl'
  distro?: string
  account?: SourceAccount
}

export interface CCTranscriptMessage {
  role: 'user' | 'assistant'
  text: string
  thinking?: string
  toolCalls: { id: string; tool: string; input: unknown; result?: string; isError?: boolean }[]
  timestamp: number
}

export interface UsageEntry {
  day: string
  model: string
  project: string
  source: string
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  costUsd: number
}

export interface UsageWindows {
  hour: { costUsd: number; tokens: number }
  session: { costUsd: number; tokens: number }
  week: { costUsd: number; tokens: number }
}

export interface UsageReport {
  entries: UsageEntry[]
  windows: UsageWindows
  generatedAt: number
}

export interface McpServer {
  name: string
  scope: 'global' | 'project'
  /** Where it's defined: 'local' or a WSL distro name. */
  source: string
  projectPath?: string
  transport: 'stdio' | 'sse' | 'http' | 'unknown'
  command?: string
  args?: string[]
  url?: string
  needsAuth: boolean
  config: Record<string, unknown>
}

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'

export interface AgentDef {
  id: string
  name: string
  icon: string
  systemPrompt: string
  model: string
  permissionMode: PermissionMode
  allowedTools: string[]
  defaultProjectPath?: string
  createdAt: number
  updatedAt: number
}

export interface ClaudeMdFile {
  scope: string
  path: string
  exists: boolean
  content: string
}

// ─── Claude permissions & hooks (from ~/.claude/settings.json) ────────────────

export interface WriteResult {
  ok: boolean
  error?: string
}

export interface ClaudePermissions {
  allow: string[]
  deny: string[]
  ask: string[]
}

export interface ClaudeHookCommand {
  type: 'command'
  command: string
}

export interface ClaudeHookEntry {
  matcher?: string
  hooks: ClaudeHookCommand[]
}

export type ClaudeHooks = Record<string, ClaudeHookEntry[]>

export const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStop',
  'Notification',
  'UserPromptSubmit',
  'SessionStart'
] as const

export type HookEvent = (typeof HOOK_EVENTS)[number]

export interface CheckpointMeta {
  id: string
  sessionId: string
  label: string
  createdAt: number
  messageCount: number
  fileCount: number
}

export interface RestoreResult {
  restored: number
  safetyCheckpointId: string | null
}

export interface CheckpointFileDiff {
  path: string
  before: string
  after: string
}

export interface CheckpointDiff {
  files: CheckpointFileDiff[]
}

export interface GitFile {
  path: string
  index: string
  worktree: string
  staged: boolean
  untracked: boolean
}

export interface GitStatus {
  isRepo: boolean
  branch: string
  files: GitFile[]
  ahead: number
  behind: number
}

export interface ImageAttachment {
  mediaType: string
  data: string
  preview: string
}

export type SshAuthType = 'password' | 'key' | 'agent'

export interface SshHostPublic {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: SshAuthType
  privateKeyPath?: string
  remotePath?: string
  claudePath?: string
  hasSecret: boolean
}

export interface SshHostInput {
  id?: string
  name: string
  host: string
  port: number
  username: string
  authType: SshAuthType
  password?: string
  privateKeyPath?: string
  passphrase?: string
  remotePath?: string
  claudePath?: string
}

export interface WslDistro {
  name: string
  isDefault: boolean
}

export type AuthMode = 'claude-code' | 'api-key'

export interface AuthStatus {
  mode: AuthMode
  claudeCodeDetected: boolean
  hasApiKey: boolean
}

export interface CCAccountStatus {
  id: string
  name: string
  configDir: string | null
  isDefault: boolean
  loggedIn: boolean
  email?: string
  org?: string
  plan?: string
}

export interface AccountList {
  accounts: CCAccountStatus[]
  defaultAccountId: string
}

export type AgentEvent =
  | { appSessionId: string; kind: 'system'; claudeSessionId?: string; tools: string[] }
  | { appSessionId: string; kind: 'text'; content: string }
  | { appSessionId: string; kind: 'thinking'; content: string }
  | { appSessionId: string; kind: 'tool-use'; tool: string; input: unknown; toolId: string }
  | { appSessionId: string; kind: 'tool-result'; toolId: string; content: string; isError: boolean }

export interface AgentDone {
  appSessionId: string
  claudeSessionId?: string
  costUsd: number
  isError: boolean
  errorText?: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
}

export interface AgentError {
  appSessionId: string
  error: string
}

export interface ApprovalRequest {
  appSessionId: string
  approvalId: string
  tool: string
  input: Record<string, unknown>
}

// ─── Planner ──────────────────────────────────────────────────────────────────

export type Effort = 'light' | 'medium' | 'deep'

export interface WeeklyPriority {
  id: string
  title: string
  color: string
}

export interface PlannerTask {
  id: string
  title: string
  /** 0 = Monday … 6 = Sunday, or null for the unscheduled backlog. */
  day: number | null
  done: boolean
  priorityId?: string | null
  /** Start time, "HH:MM". */
  timeOfDay?: string | null
  /** End time, "HH:MM". */
  endTime?: string | null
  durationMin?: number | null
  effort?: Effort | null
  notes?: string | null
}

export interface SavedReview {
  id: string
  createdAt: number
  mode: 'review' | 'reflect'
  model?: string
  score?: number | null
  summary?: string
  warnings?: string[]
  suggestions?: { title: string; detail?: string }[]
  wins?: string[]
  misses?: string[]
  adjustments?: string[]
}

export interface WeekPlan {
  weekStart: string
  intention?: string
  priorities: WeeklyPriority[]
  tasks: PlannerTask[]
  reflection?: string
  reviews?: SavedReview[]
  createdAt: number
  updatedAt: number
}

export type PlannerAssistMode = 'review' | 'draft' | 'reflect' | 'rebalance' | 'import'

// ─── Slash commands & skills ──────────────────────────────────────────────────

export interface SlashCommand {
  name: string
  kind: 'command' | 'skill'
  scope: 'user' | 'project'
  description?: string
}

export interface PlannerAssistResult {
  ok: boolean
  data?: unknown
  error?: string
  raw?: string
  costUsd: number
}

// ─── Terminal (embedded PTY) ────────────────────────────────────────────────

export interface TerminalCreateOptions {
  cwd?: string
  accountId?: string
  /** Run inside this WSL distro (for WSL-backed chats). */
  wslDistro?: string
  cols: number
  rows: number
}

export interface TerminalCreateResult {
  ok: boolean
  shell?: string
}

export interface TerminalDataEvent {
  id: string
  data: string
}

export interface TerminalExitEvent {
  id: string
  exitCode: number
}

declare global {
  interface Window {
    electronAPI: {
      // Notifications
      notify: (title: string, body: string) => Promise<{ shown: boolean }>
      setZoom: (factor: number) => Promise<number>

      // Tray / quick-launcher overlay — events received by the MAIN window
      onNewChat: (cb: () => void) => () => void
      onOverlayPrompt: (cb: (payload: { prompt: string; quick?: boolean }) => void) => () => void
      onOpenSession: (cb: (sessionId: string) => void) => () => void

      // Quick-launcher overlay — calls made by the OVERLAY window
      overlaySubmit: (payload: { prompt: string; quick?: boolean }) => void
      overlayOpenSession: (sessionId: string) => void
      overlayOpenMain: () => void
      overlayHide: () => void
      overlayShortcut: () => Promise<string>
      onOverlayShown: (cb: () => void) => () => void

      // Window controls (custom frameless title bar)
      windowMinimize: () => Promise<void>
      windowMaximizeToggle: () => Promise<boolean>
      windowClose: () => Promise<void>
      windowIsMaximized: () => Promise<boolean>
      windowGetBounds: () => Promise<{ x: number; y: number; width: number; height: number }>
      windowSetBounds: (bounds: { x: number; y: number; width: number; height: number }) => void
      onWindowMaximized: (cb: (maximized: boolean) => void) => () => void

      // Auth
      authStatus: () => Promise<AuthStatus>
      setAuthMode: (mode: AuthMode) => Promise<AuthStatus>
      setApiKey: (key: string) => Promise<AuthStatus>
      clearApiKey: () => Promise<AuthStatus>
      hasApiKey: () => Promise<boolean>

      // Accounts (multiple Claude Code logins)
      accountsList: () => Promise<AccountList>
      accountsAdd: (name: string) => Promise<CCAccountStatus>
      accountsRename: (id: string, name: string) => Promise<AccountList>
      accountsRemove: (id: string) => Promise<AccountList>
      accountsSetDefault: (id: string) => Promise<AccountList>
      accountsLogin: (id: string) => Promise<{ launched: boolean; command: string }>

      // Agent
      sendAgent: (payload: {
        appSessionId: string
        claudeSessionId?: string
        prompt: string
        projectPath?: string
        model?: string
        systemPrompt?: string
        permissionMode?: PermissionMode
        allowedTools?: string[]
        useMcp?: boolean
        approvalMode?: 'ask' | 'auto'
        images?: { mediaType: string; data: string }[]
        remoteHostId?: string
        wslDistro?: string
        accountId?: string
      }) => void
      stopAgent: (appSessionId: string) => Promise<{ stopped: boolean }>
      onAgentEvent: (cb: (data: AgentEvent) => void) => () => void
      onAgentDone: (cb: (data: AgentDone) => void) => () => void
      onAgentError: (cb: (data: AgentError) => void) => () => void
      onApprovalRequest: (cb: (data: ApprovalRequest) => void) => () => void
      respondApproval: (payload: {
        approvalId: string
        allow: boolean
        updatedInput?: Record<string, unknown>
      }) => Promise<{ ok: boolean }>
      onApprovalResolved: (cb: (approvalId: string) => void) => () => void

      // Approval toast window
      onToastApproval: (cb: (data: ApprovalRequest) => void) => () => void
      toastOpenMain: () => void

      // Agent status pill window
      onPillUpdate: (
        cb: (data: {
          state?: 'running' | 'done' | 'error'
          sessionName?: string
          tool?: string | null
        }) => void
      ) => () => void
      pillOpenMain: () => void

      // Config / models
      getConfig: () => Promise<AppConfig>
      getModels: () => Promise<ModelInfo[]>
      setDefaultModel: (modelId: string) => Promise<{ defaultModel: string }>
      setLimits: (limits: Partial<UsageLimits>) => Promise<UsageLimits>
      setUiPrefs: (prefs: Partial<UiPrefs>) => Promise<UiPrefs>

      // Claude Code data
      ccSources: () => Promise<SourceInfo[]>
      ccListProjects: () => Promise<CCProject[]>
      ccListSessions: (sourceId: string, encodedDir: string) => Promise<CCSessionMeta[]>
      ccReadSession: (
        sourceId: string,
        encodedDir: string,
        sessionId: string
      ) => Promise<CCTranscriptMessage[]>
      ccUsage: (force?: boolean) => Promise<UsageReport>
      ccSearch: (query: string) => Promise<SearchHit[]>

      // MCP
      mcpList: () => Promise<McpServer[]>
      mcpUpsert: (name: string, cfg: Record<string, unknown>) => Promise<McpServer[]>
      mcpRemove: (name: string) => Promise<McpServer[]>

      // Agents
      agentsList: () => Promise<AgentDef[]>
      agentsSave: (agent: AgentDef) => Promise<AgentDef>
      agentsDelete: (id: string) => Promise<AgentDef[]>

      // Chat compaction
      summarizeChat: (payload: {
        transcript: string
        model?: string
        accountId?: string
      }) => Promise<{ ok: boolean; summary?: string; error?: string }>

      // Planner
      plannerList: () => Promise<string[]>
      plannerGet: (weekStart: string) => Promise<WeekPlan>
      plannerSave: (week: WeekPlan) => Promise<WeekPlan>
      plannerDelete: (weekStart: string) => Promise<string[]>
      plannerAssist: (payload: {
        mode: PlannerAssistMode
        week: WeekPlan
        notes?: string
        images?: { mediaType: string; data: string }[]
        model?: string
        accountId?: string
      }) => Promise<PlannerAssistResult>

      // Claude permissions & hooks
      getClaudePermissions: () => Promise<ClaudePermissions>
      setClaudePermissions: (perms: ClaudePermissions) => Promise<WriteResult & { permissions?: ClaudePermissions }>
      getClaudeHooks: () => Promise<ClaudeHooks>
      setClaudeHooks: (hooks: ClaudeHooks) => Promise<WriteResult & { hooks?: ClaudeHooks }>

      // CLAUDE.md
      claudeMdRead: (projectPath?: string) => Promise<ClaudeMdFile[]>
      claudeMdWrite: (filePath: string, content: string) => Promise<{ success: boolean }>

      // Checkpoints
      checkpointCreate: (
        sessionId: string,
        label: string,
        files: string[],
        messageCount: number
      ) => Promise<CheckpointMeta>
      checkpointList: (sessionId: string) => Promise<CheckpointMeta[]>
      checkpointRestore: (sessionId: string, id: string) => Promise<RestoreResult>
      checkpointDelete: (sessionId: string, id: string) => Promise<CheckpointMeta[]>
      checkpointCompare: (sessionId: string, idA: string, idB: string) => Promise<CheckpointDiff>
      checkpointSavePatch: (
        sessionId: string,
        idA: string,
        idB: string
      ) => Promise<{ saved: boolean; filePath?: string; reason?: string }>

      // SSH
      sshList: () => Promise<SshHostPublic[]>
      sshSave: (host: SshHostInput) => Promise<SshHostPublic[]>
      sshDelete: (id: string) => Promise<SshHostPublic[]>
      sshTest: (id: string) => Promise<{ ok: boolean; message: string }>

      // WSL
      wslList: () => Promise<WslDistro[]>
      wslTest: (distro: string) => Promise<{ ok: boolean; message: string }>
      wslHidden: () => Promise<string[]>
      wslSetHidden: (distro: string, hidden: boolean) => Promise<string[]>

      // Git
      gitStatus: (cwd: string) => Promise<GitStatus>
      gitDiff: (cwd: string, filePath: string, staged: boolean) => Promise<string>
      gitStage: (cwd: string, filePath: string) => Promise<GitStatus>
      gitUnstage: (cwd: string, filePath: string) => Promise<GitStatus>
      gitStageAll: (cwd: string) => Promise<GitStatus>
      gitCommit: (cwd: string, message: string) => Promise<{ ok: boolean; message: string }>

      // File system
      readDir: (dirPath: string) => Promise<FileNode[] | { error: string }>
      readFile: (filePath: string) => Promise<{ content?: string; error?: string }>
      openFolder: () => Promise<string | null>

      // Sessions
      listSessions: () => Promise<Session[]>
      saveSession: (session: Session) => Promise<{ success: boolean }>
      deleteSession: (id: string) => Promise<{ success: boolean }>
      exportSession: (session: Session, format: 'md' | 'html') => Promise<{ saved: boolean; filePath?: string }>

      // Commands & skills
      commandsList: (projectPath?: string) => Promise<SlashCommand[]>

      // Scheduler / Routines
      schedulerList: () => Promise<ScheduledRun[]>
      schedulerUpsert: (run: ScheduledRun) => Promise<ScheduledRun>
      schedulerDelete: (id: string) => Promise<ScheduledRun[]>
      schedulerSetEnabled: (id: string, enabled: boolean) => Promise<ScheduledRun[]>
      schedulerRunNow: (id: string) => Promise<{ ok: boolean; summary: string; costUsd: number } | null>

      // Terminal (embedded PTY)
      terminalCreate: (id: string, opts: TerminalCreateOptions) => Promise<TerminalCreateResult>
      terminalWrite: (id: string, data: string) => void
      terminalResize: (id: string, cols: number, rows: number) => void
      terminalKill: (id: string) => Promise<{ ok: boolean }>
      terminalStartClaude: (id: string, resumeSessionId?: string) => Promise<{ ok: boolean }>
      onTerminalData: (cb: (data: TerminalDataEvent) => void) => () => void
      onTerminalExit: (cb: (data: TerminalExitEvent) => void) => () => void
    }
  }
}
