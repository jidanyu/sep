import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import MarkdownContent from './components/MarkdownContent';
import { defaultState, providerModelPresets, providerProfiles } from './data/mock';
import {
  DebugRequestEntry,
  ModelVariant,
  ProviderConnection,
  ProviderId,
  ProviderModelPreset,
  ToolDefinition,
  TranscriptEntry,
  TransportKind,
  WorkspaceState,
} from './types';

type Locale = 'zh-CN' | 'en';
type SettingsSection = 'openai' | 'claude' | 'tools' | 'appearance';
type ThemeMode = 'dark' | 'rust-light';
type DebugDetailTab = 'request' | 'response';
type PersistedWorkspaceState = Omit<WorkspaceState, 'providerConnections'>;

interface ContextMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface PreparedProviderRequest {
  providerId: ProviderId;
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  model: string;
  variant: ModelVariant;
  historyMessageCount: number;
  payloadMessageCount: number;
  inputChars: number;
  requestJson: string;
}

interface OpenAiFunctionTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface ToolCallMessage {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface ToolInvokeResponse {
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface LocalModelRequest {
  providerId: ProviderId;
  baseUrl: string;
  apiKey: string;
  payload: Record<string, unknown>;
}

interface LocalModelResult {
  content: string;
  toolCalls: ToolCallMessage[];
  rawResponseText?: string;
}

interface ParsedOpenAiConfig {
  endpoint: string;
  apiKey: string;
  models: Array<{
    id: string;
    name: string;
    contextLimit: number;
    outputLimit: number;
    variants: ModelVariant[];
    store: boolean;
  }>;
}

interface LocalModelEnvelope {
  ok: boolean;
  result?: LocalModelResult;
  error?: string;
}

interface LocalModelStreamEvent {
  eventType: 'start' | 'chunk' | 'done' | 'error';
  text?: string;
  message?: string;
  rawResponseText?: string;
}

interface NativeProviderConfigResult {
  connections: ProviderConnection[];
  openAiConfigText?: string;
  dbPath: string;
}

interface NativeProviderConfigEnvelope {
  ok: boolean;
  result?: NativeProviderConfigResult;
  error?: string;
}

interface NativeWorkspaceStateResult {
  workspaceState?: PersistedWorkspaceState;
  locale?: Locale;
  themeMode?: ThemeMode;
  dbPath: string;
}

interface NativeWorkspaceStateEnvelope {
  ok: boolean;
  result?: NativeWorkspaceStateResult;
  error?: string;
}

interface LocalServerHealthResult {
  ok: boolean;
  workspaceRoot?: string;
}

interface OpenDirectoryDialogResult {
  path?: string | null;
}

const SYSTEM_PROMPT =
  'You are a concise desktop coding assistant. Reply directly to the user request. When using tools, all paths must be workspace-relative. When creating or editing files, always provide an explicit `path` and the full `content`.';
const MAX_CONTEXT_MESSAGES = 6;
const MAX_TOOL_ROUNDS = 8;
const TOOL_SERVER_URL = 'http://127.0.0.1:4097';
const TOOL_SERVER_READY_TIMEOUT_MS = 45_000;
const TOOL_SERVER_HEALTH_TIMEOUT_MS = 1_500;
const TOOL_SERVER_POLL_INTERVAL_MS = 500;
const TOOL_CALL_CONTENT_FALLBACK = '[Tool call requested]';

interface ToolFunctionInfo {
  name: string;
  description: string;
  details: string[];
}

const TOOL_FUNCTIONS: Record<string, ToolFunctionInfo[]> = {
  shell: [
    {
      name: 'run_command',
      description: '在工作区里执行命令并返回 stdout / stderr / exit code。用于装依赖、跑测试、构建、搜索和 Git。',
      details: ['参数: `command`', '可选: `cwd`, `timeout_ms`', '可执行 `npm`、`pnpm`、`bun`、`cargo`、`rg`、`git` 等'],
    },
  ],
  editor: [
    {
      name: 'read_file',
      description: '读取文件内容，支持按行窗口返回。',
      details: ['参数: `path`', '可选: `offset`, `limit`'],
    },
    {
      name: 'write_file',
      description: '整文件写入，直接覆盖目标文件内容。',
      details: ['参数: `path`, `content`'],
    },
    {
      name: 'patch_file',
      description: '按精确文本匹配做局部修改。',
      details: ['参数: `path`, `edits[]`', '每个 edit: `find`, `replace`, `replace_all?`'],
    },
  ],
  fetch: [
    {
      name: 'web_fetch',
      description: '抓取网页或远程文档并转成可读文本。',
      details: ['参数: `url`', '可选: `format` = `markdown` | `text` | `html`, `timeout_ms`'],
    },
  ],
};

const copy = {
  'zh-CN': {
    appLabel: 'SEP 工作台',
    title: 'v0.1 代理桌面',
    subtitle: '单会话、多 provider、基础 tools、基础 MCP、基础 transcript。',
    providers: 'Providers',
    providerSettings: 'Provider 接入',
    providerPageTitle: '设置 - 提供商',
    settings: '设置',
    closeSettings: '关闭设置',
    providerSection: '提供商',
    providerSectionDesc: '配置 OpenAI、Codex 和其他模型接入',
    settingsOverview: '设置导航',
    sessions: '会话',
    newSession: '新建会话',
    clearSession: '清空会话',
    currentSession: '当前会话',
    workingDirectory: '工作目录',
    chooseSystemDirectory: '选择系统目录',
    chooseProvider: '当前提供商',
    chooseModel: '当前模型',
    chooseVariant: '推理强度',
    editJson: '直接修改配置 JSON',
    saveJson: '保存配置',
    openaiConfig: 'OpenAI',
    claudeConfig: 'Claude',
    toolsConfig: '工具',
    appearanceConfig: '外观',
    rawConfig: '原始配置',
    jsonApplied: 'OpenAI JSON 配置已应用。',
    jsonInvalid: 'JSON 格式无效，无法应用配置。',
    openaiConfigDesc: '兼容 OpenAI / Codex 的 provider 配置',
    claudeConfigDesc: 'Claude 接入与模型配置',
    toolsConfigDesc: '查看当前工具、状态与可调用函数',
    appearanceConfigDesc: '主题、配色与界面观感',
    toolsHint: '工具分为 Shell 和 Editor。Shell 负责命令、依赖、测试、构建、搜索和 Git；Editor 负责直接读写和修改文件。',
    toolCategory: '分类',
    toolFunctions: '函数',
    toolFunctionDesc: '说明',
    toolFunctionDetail: '详情',
    expandDetail: '展开详情',
    toolStatus: '状态',
    noToolFunctions: '当前没有暴露函数',
    theme: '主题',
    darkTheme: '夜间主题',
    rustLightTheme: 'Rust 淡黄色',
    appearanceHint: '选择界面的整体观感与输入控件主题。',
    activeTools: '启用工具',
    mcpLinks: 'MCP 连接',
    currentProvider: '当前 Provider',
    modelProfile: '模型画像',
    strength: '擅长方向',
    behavior: '行为风格',
    builtInTools: '内建工具',
    mcp: 'MCP',
    promptPlaceholder: '请在这里发号施令',
    ready: '就绪',
    streaming: '正在增量输出...',
    send: '发送',
    working: '处理中',
    promptQueued: '已加入请求',
    streamingResponse: '流式响应',
    providerSwitched: '已切换 Provider',
    sessionCleared: '会话已清空',
    languageMode: '中文模式',
    systemRole: '系统',
    userRole: '用户',
    assistantRole: '助手',
    toolRole: '工具',
    endpoint: '接口地址',
    apiKey: 'API Key',
    connect: '连接',
    disconnect: '断开',
    connected: '已连接',
    disconnected: '未连接',
    enabled: '已启用',
    disabled: '已关闭',
    saveHint: '本地保存，仅作 v0.1 接入占位。',
    model: '模型',
    variant: '变体',
    store: '允许提供商保留会话',
    limits: '上下文 / 输出',
    providerConfigHint: '参考 OpenCode 风格 provider 配置，支持 Codex 兼容模型接入。',
    activeModelLabel: '当前模型',
    enterHint: '回车发送，Shift+回车换行',
    providerAccepted: (provider: string) => `${provider} 已接收任务。`,
    continuity: '它会保持本地优先，并保留 transcript 的连续性。',
    noFlicker: '已启用工具保持作用域隔离，MCP 继续保持可选，界面通过增量更新避免闪烁。',
    switchBody: (provider: string) => `当前 provider 已切换为 ${provider}。模型画像已更新，当前会话状态不会被重置。`,
    providerConnected: (provider: string) => `${provider} 接入已保存并标记为已连接。`,
    providerDisconnected: (provider: string) => `${provider} 已断开连接，但配置仍保留在本地。`,
    clearedBody: '当前会话内容已清空，Provider、设置和工具状态保持不变。',
    missingKey: '当前 provider 尚未填写 API Key。',
    missingModel: '当前 provider 尚未选择模型。',
    providerDisabled: '当前 provider 未启用或未连接。',
    unsupportedDev: '当前在浏览器开发模式下，无法直接安全调用桌面端 provider。请用 `just dev` 启动 Tauri 桌面应用。',
    requestFailed: '请求失败',
    debug: '调试',
    debugTitle: 'LLM 请求调试',
    debugSubtitle: '查看每次发送给模型的参数，验证上下文是否生效。',
    closeDebug: '关闭调试',
    openDebug: '打开调试',
    clearDebug: '清空历史',
    requestHistory: '请求历史',
    contextPolicy: '上下文策略',
    contextPolicyValue: (count: number) => `最近 ${count} 条对话消息 + 当前输入`,
    historyMessages: '历史消息数',
    payloadMessages: '发送消息数',
    transportLabel: '通道',
    outputChars: '输出字符',
    durationLabel: '耗时',
    requestPayload: '请求参数',
    rawResponse: '原始响应',
    noRawResponse: '当前请求还没有可展示的原始响应。工具轮次会保留原始返回；流式请求暂不保留完整事件流。',
    noDebugRequests: '当前还没有请求记录。发送一条消息后，这里会显示实际发给模型的参数。',
    statusPending: '待完成',
    statusDone: '已完成',
    statusError: '错误',
    providerConfigLoading: 'Provider 配置正在从本地 SQLite 加载，请稍后再发送。',
    localServerUnavailable: (detail?: string) =>
      detail
        ? `本地 Rust 模型服务尚未就绪或不可访问。请稍等片刻，或运行 \`just tool-server\`。（原始错误：${detail}）`
        : '本地 Rust 模型服务尚未就绪或不可访问。请稍等片刻，或运行 `just tool-server`。',
  },
  en: {
    appLabel: 'SEP Workspace',
    title: 'v0.1 agent desktop',
    subtitle: 'Single session, multi-provider, basic tools, basic MCP, basic transcript.',
    providers: 'Providers',
    providerSettings: 'Provider Access',
    providerPageTitle: 'Settings - Providers',
    settings: 'Settings',
    closeSettings: 'Close settings',
    providerSection: 'Providers',
    providerSectionDesc: 'Configure OpenAI, Codex, and other provider access',
    settingsOverview: 'Settings nav',
    sessions: 'Sessions',
    newSession: 'New session',
    clearSession: 'Clear session',
    currentSession: 'Current session',
    workingDirectory: 'Working directory',
    chooseSystemDirectory: 'Choose system directory',
    chooseProvider: 'Provider',
    chooseModel: 'Model',
    chooseVariant: 'Variant',
    editJson: 'Edit config JSON',
    saveJson: 'Save config',
    openaiConfig: 'OpenAI',
    claudeConfig: 'Claude',
    toolsConfig: 'Tools',
    appearanceConfig: 'Appearance',
    rawConfig: 'Raw config',
    jsonApplied: 'OpenAI JSON config applied.',
    jsonInvalid: 'Invalid JSON format.',
    openaiConfigDesc: 'OpenAI / Codex compatible provider config',
    claudeConfigDesc: 'Claude access and model settings',
    toolsConfigDesc: 'Inspect current tools, status, and callable functions',
    appearanceConfigDesc: 'Theme, color, and interface look',
    toolsHint: 'Tools are split into Shell and Editor. Shell handles commands, dependencies, tests, builds, search, and git; Editor handles direct file reads and edits.',
    toolCategory: 'Category',
    toolFunctions: 'Functions',
    toolFunctionDesc: 'Description',
    toolFunctionDetail: 'Details',
    expandDetail: 'Expand',
    toolStatus: 'Status',
    noToolFunctions: 'No functions exposed right now',
    theme: 'Theme',
    darkTheme: 'Dark',
    rustLightTheme: 'Rust light',
    appearanceHint: 'Choose the overall theme and input control appearance.',
    activeTools: 'Active tools',
    mcpLinks: 'MCP links',
    currentProvider: 'Current provider',
    modelProfile: 'Model profile',
    strength: 'Strength',
    behavior: 'Behavior',
    builtInTools: 'Built-in tools',
    mcp: 'MCP',
    promptPlaceholder: 'Design a low-flicker coding workspace compatible with Claude and Codex style harnesses.',
    ready: 'Ready',
    streaming: 'Streaming incrementally...',
    send: 'Send',
    working: 'Working',
    promptQueued: 'Prompt queued',
    streamingResponse: 'Streaming response',
    providerSwitched: 'Provider switched',
    sessionCleared: 'Session cleared',
    languageMode: 'Chinese mode',
    systemRole: 'system',
    userRole: 'user',
    assistantRole: 'assistant',
    toolRole: 'tool',
    endpoint: 'Endpoint',
    apiKey: 'API Key',
    connect: 'Connect',
    disconnect: 'Disconnect',
    connected: 'Connected',
    disconnected: 'Offline',
    enabled: 'Enabled',
    disabled: 'Disabled',
    saveHint: 'Saved locally as a v0.1 provider access placeholder.',
    model: 'Model',
    variant: 'Variant',
    store: 'Allow provider retention',
    limits: 'Context / Output',
    providerConfigHint: 'References an OpenCode-style provider config and supports Codex-compatible models.',
    activeModelLabel: 'Active model',
    enterHint: 'Enter sends, Shift+Enter adds a newline',
    providerAccepted: (provider: string) => `${provider} accepts the task. `,
    continuity: 'It keeps the session local-first and preserves transcript continuity. ',
    noFlicker: 'Enabled tools remain scoped, MCP stays optional, and rendering updates incrementally to avoid flicker.',
    switchBody: (provider: string) => `Active provider is now ${provider}. Model profile changed without resetting session state.`,
    providerConnected: (provider: string) => `${provider} access was saved and marked as connected.`,
    providerDisconnected: (provider: string) => `${provider} was disconnected, but the local configuration was preserved.`,
    clearedBody: 'The current transcript was cleared. Provider, settings, and tool state were preserved.',
    missingKey: 'The current provider is missing an API key.',
    missingModel: 'The current provider is missing a model selection.',
    providerDisabled: 'The current provider is disabled or disconnected.',
    unsupportedDev: 'This browser-only dev mode cannot safely call desktop providers. Launch the Tauri app with `just dev`.',
    requestFailed: 'Request failed',
    debug: 'Debug',
    debugTitle: 'LLM request debug',
    debugSubtitle: 'Inspect every request sent to the model and verify that context is included.',
    closeDebug: 'Close debug',
    openDebug: 'Open debug',
    clearDebug: 'Clear history',
    requestHistory: 'Request history',
    contextPolicy: 'Context policy',
    contextPolicyValue: (count: number) => `Last ${count} chat messages + current prompt`,
    historyMessages: 'History messages',
    payloadMessages: 'Payload messages',
    transportLabel: 'Transport',
    outputChars: 'Output chars',
    durationLabel: 'Duration',
    requestPayload: 'Request payload',
    rawResponse: 'Raw response',
    noRawResponse: 'No raw response is available yet. Tool rounds keep the original model response; streaming requests do not keep the full event stream yet.',
    noDebugRequests: 'No request has been sent yet. Send a message and the exact LLM payload will appear here.',
    statusPending: 'Pending',
    statusDone: 'Done',
    statusError: 'Error',
    providerConfigLoading: 'Provider config is still loading from local SQLite storage. Please wait a moment.',
    localServerUnavailable: (detail?: string) =>
      detail
        ? `The local Rust model service is not ready or unreachable yet. Wait a moment, or run \`just tool-server\`. (Original error: ${detail})`
        : 'The local Rust model service is not ready or unreachable yet. Wait a moment, or run `just tool-server`.',
  },
} as const;

const USER_PROMPT_TITLES = new Set<string>([copy['zh-CN'].promptQueued, copy['en'].promptQueued]);
const ASSISTANT_RESPONSE_TITLES = new Set<string>([copy['zh-CN'].streamingResponse, copy['en'].streamingResponse]);

function createEntry(role: TranscriptEntry['role'], title: string, body: string, detail?: string): TranscriptEntry {
  return {
    id: crypto.randomUUID(),
    role,
    title,
    body,
    detail,
    timestamp: new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    }),
  };
}

function mergeProviderConnections(connections?: ProviderConnection[]) {
  return defaultState.providerConnections.map((defaultConnection) => {
    const savedConnection = connections?.find((connection) => connection.providerId === defaultConnection.providerId);

    return {
      ...defaultConnection,
      ...savedConnection,
    };
  });
}

function buildPersistedWorkspaceState(state: WorkspaceState): PersistedWorkspaceState {
  const { providerConnections, ...persistedState } = state;
  void providerConnections;
  return persistedState;
}

function mergeTools(tools?: ToolDefinition[]) {
  return defaultState.tools.map((defaultTool) => {
    const savedTool = tools?.find((tool) => tool.id === defaultTool.id);

    return {
      ...defaultTool,
      ...savedTool,
    };
  });
}

function mergeMcpServers(mcpServers?: WorkspaceState['mcpServers']) {
  return defaultState.mcpServers.map((defaultServer) => {
    const savedServer = mcpServers?.find((server) => server.id === defaultServer.id);

    return {
      ...defaultServer,
      ...savedServer,
    };
  });
}

function hydratePersistedWorkspaceState(persistedState?: Partial<PersistedWorkspaceState> | null): PersistedWorkspaceState {
  if (!persistedState) {
    return buildPersistedWorkspaceState(defaultState);
  }

  return {
    ...buildPersistedWorkspaceState(defaultState),
    ...persistedState,
    tools: mergeTools(persistedState.tools),
    mcpServers: mergeMcpServers(persistedState.mcpServers),
    debugRequests: Array.isArray(persistedState.debugRequests) ? persistedState.debugRequests : defaultState.debugRequests,
  };
}

function roleLabel(role: TranscriptEntry['role'], locale: Locale) {
  const text = copy[locale];
  if (role === 'system') return text.systemRole;
  if (role === 'user') return text.userRole;
  if (role === 'assistant') return text.assistantRole;
  return text.toolRole;
}

function maskApiKey(apiKey: string) {
  if (!apiKey) return '—';
  if (apiKey.length <= 6) return '••••••';
  return `${apiKey.slice(0, 3)}••••${apiKey.slice(-3)}`;
}

function isConversationEntry(entry: TranscriptEntry) {
  if (entry.role === 'user') {
    return USER_PROMPT_TITLES.has(entry.title) && Boolean(entry.body.trim());
  }

  if (entry.role === 'assistant') {
    return ASSISTANT_RESPONSE_TITLES.has(entry.title) && Boolean(entry.body.trim());
  }

  return false;
}

function buildContextMessages(transcript: TranscriptEntry[], prompt: string): ContextMessage[] {
  const history = transcript
    .filter(isConversationEntry)
    .map((entry): ContextMessage => ({
      role: entry.role === 'assistant' ? 'assistant' : 'user',
      content: entry.body,
    }))
    .slice(-MAX_CONTEXT_MESSAGES);

  return [...history, { role: 'user', content: prompt }];
}

function maskHeaderValue(headerName: string, value: string) {
  if (headerName.toLowerCase() === 'authorization') {
    const token = value.replace(/^Bearer\s+/i, '');
    return `Bearer ${maskApiKey(token)}`;
  }

  if (headerName.toLowerCase() === 'x-api-key') {
    return maskApiKey(value);
  }

  return value;
}

function buildDebugRequestJson(endpoint: string, headers: Record<string, string>, body: Record<string, unknown>) {
  const maskedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, maskHeaderValue(key, value)]),
  );

  return JSON.stringify(
    {
      method: 'POST',
      endpoint,
      headers: maskedHeaders,
      body,
    },
    null,
    2,
  );
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function getProviderPreset(
  presetsMap: Record<string, ProviderModelPreset[]>,
  providerId: ProviderId,
  modelId: string,
): ProviderModelPreset | undefined {
  return presetsMap[providerId]?.find((preset) => preset.id === modelId);
}

function normalizeEndpoint(endpoint: string, suffix: string) {
  const trimmed = endpoint.trim().replace(/\/+$/, '');
  if (trimmed.endsWith(suffix.replace(/^\//, ''))) {
    return trimmed;
  }

  return `${trimmed}${suffix}`;
}

function normalizeModelId(modelId: string) {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.includes('::')) {
    return trimmed.split('::').pop() ?? trimmed;
  }

  if (trimmed.includes('/')) {
    return trimmed.split('/').pop() ?? trimmed;
  }

  return trimmed;
}

function openAiModelUsesResponsesApi(modelId: string) {
  const normalized = normalizeModelId(modelId);
  return normalized.startsWith('gpt') && (normalized.includes('codex') || normalized.includes('pro'));
}

function resolveOpenAiDisplayEndpoint(providerConnection: ProviderConnection) {
  return normalizeEndpoint(
    providerConnection.endpoint,
    openAiModelUsesResponsesApi(providerConnection.selectedModel) ? '/responses' : '/chat/completions',
  );
}

function resolveEffectiveProviderConnection(
  providerConnection: ProviderConnection | undefined,
  parsedOpenAiConfig: ParsedOpenAiConfig | null,
) {
  if (!providerConnection) {
    return undefined;
  }

  if (providerConnection.providerId !== 'openai' || !parsedOpenAiConfig) {
    return providerConnection;
  }

  const availableModels = new Set(parsedOpenAiConfig.models.map((model) => model.id));
  const fallbackModel = parsedOpenAiConfig.models[0]?.id;

  return {
    ...providerConnection,
    endpoint: parsedOpenAiConfig.endpoint || providerConnection.endpoint,
    apiKey: parsedOpenAiConfig.apiKey || providerConnection.apiKey,
    selectedModel:
      providerConnection.selectedModel && availableModels.has(providerConnection.selectedModel)
        ? providerConnection.selectedModel
        : fallbackModel || providerConnection.selectedModel,
  };
}

function buildPreparedProviderRequest(
  providerId: ProviderId,
  providerConnection: ProviderConnection,
  transcript: TranscriptEntry[],
  prompt: string,
): PreparedProviderRequest {
  const contextMessages = buildContextMessages(transcript, prompt);
  const historyMessageCount = Math.max(contextMessages.length - 1, 0);

  if (providerId === 'openai' || providerId === 'opencode') {
    const endpoint = resolveOpenAiDisplayEndpoint(providerConnection);
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${providerConnection.apiKey}`,
    };
    const messages = [
      {
        role: 'system',
        content: SYSTEM_PROMPT,
      },
      ...contextMessages,
    ];
    const body = {
      model: providerConnection.selectedModel,
      stream: true,
      store: providerConnection.store,
      reasoning_effort: providerConnection.selectedVariant,
      messages,
    };

    return {
      providerId,
      endpoint,
      headers,
      body,
      model: providerConnection.selectedModel,
      variant: providerConnection.selectedVariant,
      historyMessageCount,
      payloadMessageCount: messages.length,
      inputChars: prompt.length,
      requestJson: buildDebugRequestJson(endpoint, headers, body),
    };
  }

  if (providerId === 'anthropic') {
    const endpoint = normalizeEndpoint(providerConnection.endpoint, '/v1/messages');
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': providerConnection.apiKey,
      'anthropic-version': '2023-06-01',
    };
    const body = {
      model: providerConnection.selectedModel,
      max_tokens: 800,
      stream: true,
      system: SYSTEM_PROMPT,
      messages: contextMessages,
    };

    return {
      providerId,
      endpoint,
      headers,
      body,
      model: providerConnection.selectedModel,
      variant: providerConnection.selectedVariant,
      historyMessageCount,
      payloadMessageCount: contextMessages.length,
      inputChars: prompt.length,
      requestJson: buildDebugRequestJson(endpoint, headers, body),
    };
  }

  throw new Error('Current provider is not yet supported.');
}

function providerSupportsCodingTools(providerId: ProviderId) {
  return providerId === 'openai' || providerId === 'opencode';
}

function buildEnabledOpenAiTools(tools: ToolDefinition[]): OpenAiFunctionTool[] {
  const enabled = new Set(tools.filter((tool) => tool.enabled).map((tool) => tool.id));
  const specs: OpenAiFunctionTool[] = [];

  if (enabled.has('editor')) {
    specs.push(
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a UTF-8 text file from the workspace, optionally limited to a line range.',
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Workspace-relative file path.',
              },
              offset: {
                type: 'integer',
                description: 'Optional 1-based starting line number.',
              },
              limit: {
                type: 'integer',
                description: 'Optional maximum number of lines to return.',
              },
            },
            required: ['path'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'write_file',
          description: 'Write a UTF-8 text file inside the workspace, replacing the whole file content.',
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Workspace-relative file path.',
              },
              content: {
                type: 'string',
                description: 'Full file content to write.',
              },
            },
            required: ['path', 'content'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'patch_file',
          description: 'Apply exact text edits to a file without rewriting unrelated content.',
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Workspace-relative file path.',
              },
              edits: {
                type: 'array',
                description: 'List of exact text edits to apply in order.',
                items: {
                  type: 'object',
                  properties: {
                    find: {
                      type: 'string',
                      description: 'Exact existing text to match.',
                    },
                    replace: {
                      type: 'string',
                      description: 'Replacement text.',
                    },
                    replace_all: {
                      type: 'boolean',
                      description: 'When true, replaces every exact match.',
                    },
                  },
                  required: ['find', 'replace'],
                  additionalProperties: false,
                },
              },
            },
            required: ['path', 'edits'],
            additionalProperties: false,
          },
        },
      },
    );
  }

  if (enabled.has('fetch')) {
    specs.push({
      type: 'function',
      function: {
        name: 'web_fetch',
        description: 'Fetch a web page or remote document and return it as markdown, text, or html.',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'Target URL to fetch. If no scheme is provided, https is assumed.',
            },
            format: {
              type: 'string',
              description: 'Optional output format: markdown, text, or html.',
            },
            timeout_ms: {
              type: 'integer',
              description: 'Optional timeout in milliseconds.',
            },
          },
          required: ['url'],
          additionalProperties: false,
        },
      },
    });
  }

  if (enabled.has('shell')) {
    specs.push({
      type: 'function',
      function: {
        name: 'run_command',
        description: 'Run a shell command inside the workspace for dependencies, tests, builds, scripts, search, and git, then return stdout, stderr, and exit code.',
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'Shell command to run.',
            },
            cwd: {
              type: 'string',
              description: 'Optional workspace-relative working directory.',
            },
            timeout_ms: {
              type: 'integer',
              description: 'Optional timeout in milliseconds.',
            },
          },
          required: ['command'],
          additionalProperties: false,
        },
      },
    });
  }

  return specs;
}

function buildOpenAiAgentRequest(
  providerId: ProviderId,
  providerConnection: ProviderConnection,
  transcript: TranscriptEntry[],
  prompt: string,
  tools: OpenAiFunctionTool[],
): PreparedProviderRequest {
  const contextMessages = buildContextMessages(transcript, prompt);
  const endpoint = resolveOpenAiDisplayEndpoint(providerConnection);
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${providerConnection.apiKey}`,
  };
  const messages = [
    {
      role: 'system',
      content: SYSTEM_PROMPT,
    },
    ...contextMessages,
  ];
  const body: Record<string, unknown> = {
    model: providerConnection.selectedModel,
    stream: false,
    store: providerConnection.store,
    reasoning_effort: providerConnection.selectedVariant,
    messages,
  };

  if (tools.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  return {
    providerId,
    endpoint,
    headers,
    body,
    model: providerConnection.selectedModel,
    variant: providerConnection.selectedVariant,
    historyMessageCount: Math.max(contextMessages.length - 1, 0),
    payloadMessageCount: messages.length,
    inputChars: prompt.length,
    requestJson: buildDebugRequestJson(endpoint, headers, body),
  };
}

function buildOpenAiFollowUpRequest(
  providerId: ProviderId,
  providerConnection: ProviderConnection,
  messages: Array<Record<string, unknown>>,
  tools: OpenAiFunctionTool[],
): PreparedProviderRequest {
  const endpoint = resolveOpenAiDisplayEndpoint(providerConnection);
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${providerConnection.apiKey}`,
  };
  const body: Record<string, unknown> = {
    model: providerConnection.selectedModel,
    stream: false,
    store: providerConnection.store,
    reasoning_effort: providerConnection.selectedVariant,
    messages,
  };

  if (tools.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  return {
    providerId,
    endpoint,
    headers,
    body,
    model: providerConnection.selectedModel,
    variant: providerConnection.selectedVariant,
    historyMessageCount: Math.max(messages.length - 2, 0),
    payloadMessageCount: messages.length,
    inputChars: JSON.stringify(messages[messages.length - 1] ?? '').length,
    requestJson: buildDebugRequestJson(endpoint, headers, body),
  };
}

function extractAssistantContent(content: unknown) {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }

        if (typeof part === 'object' && part && 'text' in part) {
          return typeof part.text === 'string' ? part.text : '';
        }

        return '';
      })
      .join('');
  }

  return '';
}

function normalizeToolCallArguments(argumentsText: string | undefined) {
  return typeof argumentsText === 'string' ? argumentsText.trim() : '';
}

function normalizeOpenAiToolCalls(toolCalls: ToolCallMessage[]) {
  const normalized: ToolCallMessage[] = [];

  for (const toolCall of toolCalls) {
    const name = toolCall.function?.name?.trim() ?? '';
    const argumentsText = normalizeToolCallArguments(toolCall.function?.arguments);
    const callId = toolCall.id?.trim() ?? '';
    const previous = normalized[normalized.length - 1];

    if (!name && argumentsText && previous && !normalizeToolCallArguments(previous.function?.arguments)) {
      previous.function.arguments = argumentsText;
      if (!previous.id && callId) {
        previous.id = callId;
      }
      continue;
    }

    if (!name && !argumentsText) {
      continue;
    }

    normalized.push({
      id: callId,
      type: 'function',
      function: {
        name,
        arguments: argumentsText,
      },
    });
  }

  return normalized
    .filter((toolCall) => toolCall.function?.name?.trim())
    .map((toolCall) => ({
      ...toolCall,
      id: toolCall.id || `tool-call-${crypto.randomUUID()}`,
      function: {
        name: toolCall.function.name.trim(),
        arguments: normalizeToolCallArguments(toolCall.function.arguments) || '{}',
      },
    }));
}

function buildAssistantToolMessage(assistantText: string, toolCalls: ToolCallMessage[]) {
  return {
    role: 'assistant',
    content: assistantText.trim() ? assistantText : TOOL_CALL_CONTENT_FALLBACK,
    tool_calls: toolCalls,
  };
}

function truncateErrorMessage(message: string, maxChars = 1200) {
  if (message.length <= maxChars) {
    return message;
  }

  return `${message.slice(0, maxChars)}\n…`;
}

function summarizeToolResult(toolName: string, response: ToolInvokeResponse) {
  if (!response.ok) {
    return {
      summary: `${toolName} failed`,
      detail: response.error ?? 'Unknown tool error.',
    };
  }

  const body = JSON.stringify(response.result ?? null, null, 2);
  const result = response.result as Record<string, unknown> | undefined;
  const path = typeof result?.path === 'string' ? result.path : null;

  if (toolName === 'read_file' && path) {
    const startLine = typeof result?.startLine === 'number' ? result.startLine : null;
    const endLine = typeof result?.endLine === 'number' ? result.endLine : null;
    return {
      summary: startLine && endLine ? `Read ${path}:${startLine}-${endLine}` : `Read ${path}`,
      detail: body,
    };
  }

  if (toolName === 'patch_file' && path) {
    const editCount = typeof result?.editCount === 'number' ? result.editCount : 0;
    return {
      summary: `Patched ${path} with ${editCount} edit${editCount === 1 ? '' : 's'}`,
      detail: body,
    };
  }

  if (toolName === 'write_file' && path) {
    return {
      summary: `Wrote ${path}`,
      detail: body,
    };
  }

  if (toolName === 'list_dir' && path) {
    return {
      summary: `Listed ${path}`,
      detail: body,
    };
  }

  if (toolName === 'search_text') {
    const count = Array.isArray(result?.matches) ? result.matches.length : 0;
    const scope = typeof result?.path === 'string' ? result.path : '.';
    return {
      summary: `Found ${count} matches in ${scope}`,
      detail: body,
    };
  }

  if (toolName === 'run_command') {
    const command = typeof result?.command === 'string' ? result.command : 'command';
    const success = result?.success === true;
    return {
      summary: `${success ? 'Ran' : 'Command failed'}: ${command}`,
      detail: body,
    };
  }

  if (toolName === 'git_status') {
    const branch = typeof result?.branch === 'string' ? result.branch : 'repo';
    const changed = typeof result?.changedCount === 'number' ? result.changedCount : 0;
    return {
      summary: `Git status on ${branch} with ${changed} changed item${changed === 1 ? '' : 's'}`,
      detail: body,
    };
  }

  if (toolName === 'git_diff') {
    const scope = typeof result?.path === 'string' ? result.path : 'working tree';
    const staged = result?.staged === true;
    const base = typeof result?.base === 'string' ? result.base : '';
    const head = typeof result?.head === 'string' ? result.head : '';
    return {
      summary: base && head ? `Git diff ${base}...${head} for ${scope}` : `Git diff for ${scope}${staged ? ' (staged)' : ''}`,
      detail: body,
    };
  }

  if (toolName === 'git_log') {
    const count = Array.isArray(result?.commits) ? result.commits.length : 0;
    return {
      summary: `Read ${count} recent commit${count === 1 ? '' : 's'}`,
      detail: body,
    };
  }

  if (toolName === 'git_show') {
    const target = typeof result?.target === 'string' ? result.target : 'revision';
    return {
      summary: `Inspected ${target}`,
      detail: body,
    };
  }

  if (toolName === 'git_blame') {
    const path = typeof result?.path === 'string' ? result.path : 'file';
    const lineCount = Array.isArray(result?.lines) ? result.lines.length : 0;
    return {
      summary: `Git blame for ${path} (${lineCount} line${lineCount === 1 ? '' : 's'})`,
      detail: body,
    };
  }

  if (toolName === 'web_fetch') {
    const finalUrl = typeof result?.finalUrl === 'string' ? result.finalUrl : typeof result?.url === 'string' ? result.url : 'url';
    const format = typeof result?.format === 'string' ? result.format : 'markdown';
    const status = typeof result?.status === 'number' ? result.status : 200;
    return {
      summary: `Fetched ${finalUrl} as ${format} (${status})`,
      detail: body,
    };
  }

  if (toolName === 'move_path') {
    const from = typeof result?.from === 'string' ? result.from : 'source';
    const to = typeof result?.to === 'string' ? result.to : 'destination';
    return {
      summary: `Moved ${from} -> ${to}`,
      detail: body,
    };
  }

  if (toolName === 'delete_path' && path) {
    return {
      summary: `Deleted ${path}`,
      detail: body,
    };
  }

  if (toolName === 'stat_path' && path) {
    return {
      summary: `Inspected ${path}`,
      detail: body,
    };
  }

  return {
    summary: `${toolName} completed`,
    detail: body,
  };
}

const defaultOpenAiConfigJson = `{
  "provider": {
    "openai": {
      "options": {
        "baseURL": "https://api.openai.com/v1",
        "apiKey": ""
      },
      "models": {
        "gpt-5-codex": {
          "name": "GPT-5 Codex",
          "limit": { "context": 400000, "output": 128000 },
          "options": { "store": false },
          "variants": { "low": {}, "medium": {}, "high": {} }
        },
        "gpt-5.1-codex": {
          "name": "GPT-5.1 Codex",
          "limit": { "context": 400000, "output": 128000 },
          "options": { "store": false },
          "variants": { "low": {}, "medium": {}, "high": {} }
        },
        "gpt-5.1-codex-max": {
          "name": "GPT-5.1 Codex Max",
          "limit": { "context": 400000, "output": 128000 },
          "options": { "store": false },
          "variants": { "low": {}, "medium": {}, "high": {} }
        },
        "gpt-5.1-codex-mini": {
          "name": "GPT-5.1 Codex Mini",
          "limit": { "context": 400000, "output": 128000 },
          "options": { "store": false },
          "variants": { "low": {}, "medium": {}, "high": {} }
        },
        "gpt-5.2": {
          "name": "GPT-5.2",
          "limit": { "context": 400000, "output": 128000 },
          "options": { "store": false },
          "variants": { "low": {}, "medium": {}, "high": {}, "xhigh": {} }
        },
        "gpt-5.3-codex-spark": {
          "name": "GPT-5.3 Codex Spark",
          "limit": { "context": 128000, "output": 32000 },
          "options": { "store": false },
          "variants": { "low": {}, "medium": {}, "high": {}, "xhigh": {} }
        },
        "gpt-5.3-codex": {
          "name": "GPT-5.3 Codex",
          "limit": { "context": 400000, "output": 128000 },
          "options": { "store": false },
          "variants": { "low": {}, "medium": {}, "high": {}, "xhigh": {} }
        },
        "gpt-5.2-codex": {
          "name": "GPT-5.2 Codex",
          "limit": { "context": 400000, "output": 128000 },
          "options": { "store": false },
          "variants": { "low": {}, "medium": {}, "high": {}, "xhigh": {} }
        },
        "codex-mini-latest": {
          "name": "Codex Mini",
          "limit": { "context": 200000, "output": 100000 },
          "options": { "store": false },
          "variants": { "low": {}, "medium": {}, "high": {} }
        }
      }
    }
  },
  "agent": {
    "build": { "options": { "store": false } },
    "plan": { "options": { "store": false } }
  },
  "$schema": "https://opencode.ai/config.json"
}`;

function parseOpenAiConfig(configText: string): ParsedOpenAiConfig {
  const parsed = JSON.parse(configText) as {
    provider?: {
      openai?: {
        options?: { baseURL?: string; apiKey?: string };
        models?: Record<string, {
          name?: string;
          limit?: { context?: number; output?: number };
          options?: { store?: boolean };
          variants?: Record<string, object>;
        }>;
      };
    };
  };

  const openai = parsed.provider?.openai;
  const models = Object.entries(openai?.models ?? {}).map(([id, model]) => ({
    id,
    name: model.name ?? id,
    contextLimit: model.limit?.context ?? 0,
    outputLimit: model.limit?.output ?? 0,
    variants: (Object.keys(model.variants ?? {}) as ModelVariant[]).length
      ? (Object.keys(model.variants ?? {}) as ModelVariant[])
      : ['medium'],
    store: model.options?.store ?? false,
  })) as ParsedOpenAiConfig['models'];

  return {
    endpoint: openai?.options?.baseURL ?? '',
    apiKey: openai?.options?.apiKey ?? '',
    models,
  };
}

function hasProviderConnectionOverrides(connections: ProviderConnection[]) {
  return connections.some((connection) => {
    const defaultConnection = defaultState.providerConnections.find((item) => item.providerId === connection.providerId);
    if (!defaultConnection) {
      return true;
    }

    return (
      connection.apiKey.trim() !== '' ||
      connection.enabled !== defaultConnection.enabled ||
      connection.connected !== defaultConnection.connected ||
      connection.endpoint !== defaultConnection.endpoint ||
      connection.selectedModel !== defaultConnection.selectedModel ||
      connection.selectedVariant !== defaultConnection.selectedVariant ||
      connection.store !== defaultConnection.store
    );
  });
}

function hasOpenAiConfigOverride(configText?: string | null) {
  return Boolean(configText && configText.trim() && configText.trim() !== defaultOpenAiConfigJson.trim());
}

export default function App() {
  const [state, setState] = useState<WorkspaceState>(defaultState);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [workspaceStateLoaded, setWorkspaceStateLoaded] = useState(false);
  const [workspaceStateSyncEnabled, setWorkspaceStateSyncEnabled] = useState(false);
  const [providerConfigLoaded, setProviderConfigLoaded] = useState(false);
  const [providerConfigSyncEnabled, setProviderConfigSyncEnabled] = useState(false);
  const [showSettings, setShowSettings] = useState(true);
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [showDebug, setShowDebug] = useState(false);
  const [selectedDebugRequestId, setSelectedDebugRequestId] = useState<string | null>(null);
  const [debugDetailTab, setDebugDetailTab] = useState<DebugDetailTab>('request');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('openai');
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const [openAiConfigText, setOpenAiConfigText] = useState(defaultOpenAiConfigJson);
  const [showOpenAiJsonEditor, setShowOpenAiJsonEditor] = useState(false);
  const [locale, setLocale] = useState<Locale>('zh-CN');
  const transcriptRef = useRef<HTMLElement | null>(null);
  const workspaceStateSaveTimerRef = useRef<number | null>(null);
  const providerConfigSaveTimerRef = useRef<number | null>(null);
  const text = copy[locale];

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateWorkspaceRoot() {
      try {
        const response = await waitForLocalServerHealth();
        if (!cancelled && response.workspaceRoot) {
          setWorkspaceRoot(response.workspaceRoot);
        }
      } catch {
        if (!cancelled) {
          setWorkspaceRoot('');
        }
      }
    }

    void hydrateWorkspaceRoot();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function hydrateNativeWorkspaceState() {
      try {
        const nativeState = await loadNativeWorkspaceState();

        if (!cancelled) {
          setState((current) => ({
            ...current,
            ...hydratePersistedWorkspaceState(nativeState.workspaceState),
          }));
          setLocale(nativeState.locale === 'en' ? 'en' : 'zh-CN');
          setThemeMode(nativeState.themeMode === 'rust-light' ? 'rust-light' : 'dark');
          setWorkspaceStateSyncEnabled(true);
          setWorkspaceStateLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setWorkspaceStateLoaded(true);
        }
      }
    }

    void hydrateNativeWorkspaceState();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!workspaceStateLoaded || !workspaceStateSyncEnabled) {
      return;
    }

    if (workspaceStateSaveTimerRef.current) {
      window.clearTimeout(workspaceStateSaveTimerRef.current);
    }

    workspaceStateSaveTimerRef.current = window.setTimeout(() => {
      void saveNativeWorkspaceState(buildPersistedWorkspaceState(state), locale, themeMode).catch(() => undefined);
    }, 250);

    return () => {
      if (workspaceStateSaveTimerRef.current) {
        window.clearTimeout(workspaceStateSaveTimerRef.current);
      }
    };
  }, [locale, state, themeMode, workspaceStateLoaded, workspaceStateSyncEnabled]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateNativeProviderConfig() {
      try {
        const nativeConfig = await loadNativeProviderConfig();

        if (!cancelled) {
          setState((current) => ({
            ...current,
            providerConnections: mergeProviderConnections(nativeConfig.connections),
          }));
          setOpenAiConfigText(nativeConfig.openAiConfigText ?? defaultOpenAiConfigJson);
          setProviderConfigSyncEnabled(true);
          setProviderConfigLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setProviderConfigLoaded(true);
        }
      }
    }

    void hydrateNativeProviderConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!providerConfigLoaded || !providerConfigSyncEnabled) {
      return;
    }

    if (providerConfigSaveTimerRef.current) {
      window.clearTimeout(providerConfigSaveTimerRef.current);
    }

    providerConfigSaveTimerRef.current = window.setTimeout(() => {
      void saveNativeProviderConfig(state.providerConnections, openAiConfigText).catch(() => undefined);
    }, 250);

    return () => {
      if (providerConfigSaveTimerRef.current) {
        window.clearTimeout(providerConfigSaveTimerRef.current);
      }
    };
  }, [openAiConfigText, providerConfigLoaded, providerConfigSyncEnabled, state.providerConnections]);

  useEffect(() => {
    const node = transcriptRef.current;
    if (!node) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [state.transcript]);

  const activeProvider = useMemo(
    () => providerProfiles.find((provider) => provider.id === state.selectedProvider) ?? providerProfiles[0],
    [state.selectedProvider],
  );
  const activeConnection = useMemo(
    () => state.providerConnections.find((connection) => connection.providerId === state.selectedProvider),
    [state.providerConnections, state.selectedProvider],
  );
  const visibleProviders = useMemo(
    () =>
      providerProfiles.filter((provider) => {
        const connection = state.providerConnections.find((item) => item.providerId === provider.id);
        if (!connection) {
          return false;
        }

        return Boolean(connection.apiKey.trim() || connection.endpoint.trim() !== defaultState.providerConnections.find((item) => item.providerId === provider.id)?.endpoint);
      }),
    [state.providerConnections],
  );
  const parsedOpenAiConfig = useMemo(() => {
    try {
      return parseOpenAiConfig(openAiConfigText);
    } catch {
      return null;
    }
  }, [openAiConfigText]);
  const effectiveProviderPresets = useMemo<Record<string, ProviderModelPreset[]>>(
    () => ({
      ...providerModelPresets,
      openai:
        parsedOpenAiConfig?.models.map((model): ProviderModelPreset => ({
          id: model.id,
          name: model.name,
          contextLimit: model.contextLimit,
          outputLimit: model.outputLimit,
          variants: model.variants as ModelVariant[],
        })) ?? providerModelPresets.openai,
    }),
    [parsedOpenAiConfig],
  );
  const orderedDebugRequests = useMemo(() => state.debugRequests.slice().reverse(), [state.debugRequests]);
  const selectedDebugRequest = useMemo(
    () => orderedDebugRequests.find((entry) => entry.id === selectedDebugRequestId) ?? orderedDebugRequests[0] ?? null,
    [orderedDebugRequests, selectedDebugRequestId],
  );

  useEffect(() => {
    if (!visibleProviders.length) {
      return;
    }

    const exists = visibleProviders.some((provider) => provider.id === state.selectedProvider);
    if (!exists) {
      setState((current) => ({
        ...current,
        selectedProvider: visibleProviders[0].id,
      }));
    }
  }, [state.selectedProvider, visibleProviders]);

  useEffect(() => {
    if (!orderedDebugRequests.length) {
      if (selectedDebugRequestId !== null) {
        setSelectedDebugRequestId(null);
      }
      return;
    }

    const exists = orderedDebugRequests.some((entry) => entry.id === selectedDebugRequestId);
    if (!exists) {
      setSelectedDebugRequestId(orderedDebugRequests[0].id);
    }
  }, [orderedDebugRequests, selectedDebugRequestId]);

  function appendTranscript(role: TranscriptEntry['role'], title: string, body: string, detail?: string) {
    setState((current) => ({
      ...current,
      transcript: [...current.transcript, createEntry(role, title, body, detail)],
    }));
  }

  function resetSession(title: string, body: string) {
    setDraft('');
    setSelectedDebugRequestId(null);
    setState((current) => ({
      ...current,
      transcript: [
        createEntry(
          'system',
          title,
          body,
        ),
      ],
      debugRequests: [],
    }));
  }

  async function chooseSystemDirectory() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: workspaceRoot || undefined,
        title: text.chooseSystemDirectory,
      });

      if (typeof selected !== 'string') {
        return;
      }

      createNewSession(normalizePathSeparators(selected));
    } catch {
      try {
        const browserDialog = await openNativeDirectoryDialog(workspaceRoot || undefined, text.chooseSystemDirectory);
        if (browserDialog) {
          createNewSession(normalizePathSeparators(browserDialog));
          return;
        }
      } catch {
        // Fall back to a plain session reset when no native picker is available.
      }

      createNewSession();
    }
  }

  function createNewSession(workingDirectory = getSessionRootPath()) {
    resetSession(
      locale === 'zh-CN' ? '新会话已创建' : 'New session created',
      locale === 'zh-CN'
        ? `会话上下文已清空，当前 provider 与设置保持不变。默认工作目录：${workingDirectory}`
        : `Transcript was cleared. Current provider and settings were preserved. Default working directory: ${workingDirectory}`,
    );
    setState((current) => ({
      ...current,
      workingDirectory,
    }));
  }

  function clearCurrentSession() {
    resetSession(text.sessionCleared, text.clearedBody);
  }

  function setProvider(providerId: ProviderId) {
    const providerName = providerProfiles.find((item) => item.id === providerId)?.name ?? providerId;

    setState((current) => ({
      ...current,
      selectedProvider: providerId,
      transcript: [...current.transcript, createEntry('assistant', text.providerSwitched, text.switchBody(providerName))],
    }));
  }

  function updateProviderConnection(providerId: ProviderId, patch: Partial<ProviderConnection>) {
    setState((current) => ({
      ...current,
      providerConnections: current.providerConnections.map((connection) =>
        connection.providerId === providerId ? { ...connection, ...patch } : connection,
      ),
    }));
  }

  function setProviderModel(providerId: ProviderId, modelId: string) {
    const preset = getProviderPreset(effectiveProviderPresets, providerId, modelId);
    updateProviderConnection(providerId, {
      selectedModel: modelId,
      selectedVariant: preset?.variants.includes('medium') ? 'medium' : (preset?.variants[0] ?? 'medium'),
    });
  }

  function setProviderVariant(providerId: ProviderId, variant: ModelVariant) {
    updateProviderConnection(providerId, { selectedVariant: variant });
  }

  function applyOpenAiJsonConfig() {
    try {
      const parsed = parseOpenAiConfig(openAiConfigText);
      const firstModel = parsed.models[0]?.id ?? 'gpt-5-codex';
      const firstStore = parsed.models[0]?.store ?? false;
      const firstVariants = (parsed.models[0]?.variants ?? ['medium']) as ModelVariant[];

      updateProviderConnection('openai', {
        endpoint: parsed.endpoint || 'https://api.openai.com/v1',
        apiKey: parsed.apiKey,
        selectedModel: firstModel,
        selectedVariant: firstVariants.includes('medium') ? 'medium' : firstVariants[0],
        store: firstStore,
      });
      appendTranscript('system', text.saveJson, text.jsonApplied);
      setShowOpenAiJsonEditor(false);
    } catch {
      appendTranscript('system', text.requestFailed, text.jsonInvalid);
    }
  }

  function toggleProviderEnabled(providerId: ProviderId) {
    const current = state.providerConnections.find((item) => item.providerId === providerId);
    if (!current) return;

    updateProviderConnection(providerId, {
      enabled: !current.enabled,
      connected: current.enabled ? false : current.connected,
    });
  }

  function setProviderConnected(providerId: ProviderId, connected: boolean) {
    const providerName = providerProfiles.find((item) => item.id === providerId)?.name ?? providerId;
    updateProviderConnection(providerId, connected ? { connected: true, enabled: true } : { connected: false });
    appendTranscript(
      'system',
      connected ? text.connect : text.disconnect,
      connected ? text.providerConnected(providerName) : text.providerDisconnected(providerName),
    );
  }

  function toggleTool(toolId: string) {
    setState((current) => ({
      ...current,
      tools: current.tools.map((tool) =>
        tool.id === toolId ? { ...tool, enabled: !tool.enabled } : tool,
      ),
    }));
  }

  function toggleMcp(serverId: string) {
    setState((current) => ({
      ...current,
      mcpServers: current.mcpServers.map((server) =>
        server.id === serverId
          ? {
              ...server,
              enabled: !server.enabled,
              status: !server.enabled ? 'ready' : 'idle',
            }
          : server,
      ),
    }));
  }

  function clearDebugRequests() {
    setSelectedDebugRequestId(null);
    setState((current) => ({
      ...current,
      debugRequests: [],
    }));
  }

  function replaceTranscriptBody(requestId: string, body: string) {
    setState((current) => ({
      ...current,
      transcript: current.transcript.map((entry) =>
        entry.id === requestId ? { ...entry, body } : entry,
      ),
    }));
  }

  function startDebugRequest(
    requestId: string,
    preparedRequest: PreparedProviderRequest,
    transport: TransportKind,
    startedAt: string,
  ) {
    const entry: DebugRequestEntry = {
      id: crypto.randomUUID(),
      requestId,
      providerId: preparedRequest.providerId,
      model: preparedRequest.model,
      variant: preparedRequest.variant,
      transport,
      endpoint: preparedRequest.endpoint,
      startedAt,
      startedAtUnixMs: Date.now(),
      status: 'pending',
      historyMessageCount: preparedRequest.historyMessageCount,
      payloadMessageCount: preparedRequest.payloadMessageCount,
      inputChars: preparedRequest.inputChars,
      outputChars: 0,
      requestJson: preparedRequest.requestJson,
    };

    setSelectedDebugRequestId(entry.id);
    setState((current) => ({
      ...current,
      debugRequests: [...current.debugRequests, entry].slice(-24),
    }));
  }

  function appendResponseChunk(requestId: string, chunk: string) {
    setState((current) => ({
      ...current,
      transcript: current.transcript.map((entry) =>
        entry.id === requestId ? { ...entry, body: `${entry.body}${chunk}` } : entry,
      ),
      debugRequests: current.debugRequests.map((entry) =>
        entry.requestId === requestId
          ? {
              ...entry,
              outputChars: entry.outputChars + chunk.length,
            }
          : entry,
      ),
    }));
  }

  function completeDebugRequest(requestId: string, outputChars?: number) {
    setState((current) => ({
      ...current,
      debugRequests: current.debugRequests.map((entry) =>
        entry.requestId === requestId
          ? {
              ...entry,
              status: 'done',
              outputChars: outputChars ?? entry.outputChars,
              durationMs: Math.max(Date.now() - entry.startedAtUnixMs, 0),
            }
          : entry,
      ),
    }));
  }

  function setDebugRequestRawResponse(requestId: string, rawResponseText: string) {
    setState((current) => ({
      ...current,
      debugRequests: current.debugRequests.map((entry) =>
        entry.requestId === requestId
          ? {
              ...entry,
              rawResponseText,
            }
          : entry,
      ),
    }));
  }

  function markDebugRequestError(requestId: string, message: string) {
    setState((current) => ({
      ...current,
      debugRequests: current.debugRequests.map((entry) =>
        entry.requestId === requestId
          ? {
              ...entry,
              status: 'error',
              error: message,
              durationMs: Math.max(Date.now() - entry.startedAtUnixMs, 0),
            }
          : entry,
        ),
      }));
  }

  function wait(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function buildLocalServerUnavailableMessage(detail?: string) {
    return text.localServerUnavailable(detail);
  }

  async function waitForLocalServerReady() {
    const deadline = Date.now() + TOOL_SERVER_READY_TIMEOUT_MS;
    let lastError: string | undefined;

    while (Date.now() < deadline) {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), TOOL_SERVER_HEALTH_TIMEOUT_MS);

      try {
        const response = await fetch(`${TOOL_SERVER_URL}/health`, {
          cache: 'no-store',
          signal: controller.signal,
        });

        if (response.ok) {
          return;
        }

        lastError = `Health check returned ${response.status}`;
      } catch (error) {
        if (error instanceof Error) {
          lastError = error.name === 'AbortError' ? 'Health check timed out' : error.message;
        } else {
          lastError = String(error);
        }
      } finally {
        window.clearTimeout(timeoutId);
      }

      await wait(TOOL_SERVER_POLL_INTERVAL_MS);
    }

    throw new Error(buildLocalServerUnavailableMessage(lastError));
  }

  async function requestLocalServer(path: string, method: 'GET' | 'POST', body?: unknown) {
    await waitForLocalServerReady();

    try {
      return await fetch(`${TOOL_SERVER_URL}${path}`, {
        method,
        headers: body === undefined ? undefined : {
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(buildLocalServerUnavailableMessage(detail));
    }
  }

  async function fetchLocalServer(path: string, body: unknown) {
    return requestLocalServer(path, 'POST', body);
  }

  async function waitForLocalServerHealth(): Promise<LocalServerHealthResult> {
    await waitForLocalServerReady();
    const response = await fetch(`${TOOL_SERVER_URL}/health`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Health check returned ${response.status}`);
    }
    return (await response.json()) as LocalServerHealthResult;
  }

  function isAbsolutePath(path: string) {
    return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.startsWith('/');
  }

  function normalizePathSeparators(path: string) {
    return path.replace(/\\/g, '/').replace(/\/+$/, '');
  }

  function getSessionRootPath() {
    const candidate = state.workingDirectory || workspaceRoot || '.';
    if (isAbsolutePath(candidate)) {
      return normalizePathSeparators(candidate);
    }
    if (workspaceRoot && isAbsolutePath(workspaceRoot)) {
      const root = normalizePathSeparators(workspaceRoot);
      const relative = candidate === '.' ? '' : normalizePathSeparators(candidate);
      return relative ? `${root}/${relative}` : root;
    }
    return candidate;
  }

  function resolveToolPath(path: string) {
    if (!path.trim() || isAbsolutePath(path)) {
      return path;
    }

    const sessionRoot = getSessionRootPath();
    if (!isAbsolutePath(sessionRoot)) {
      return path;
    }

    const normalizedRoot = normalizePathSeparators(sessionRoot);
    const normalizedPath = normalizePathSeparators(path);
    return normalizedPath === '.' ? normalizedRoot : `${normalizedRoot}/${normalizedPath}`;
  }

  async function loadNativeWorkspaceState(): Promise<NativeWorkspaceStateResult> {
    const response = await requestLocalServer('/state/workspace', 'GET');
    const rawBody = await response.text();
    let parsed: NativeWorkspaceStateEnvelope | null = null;

    try {
      parsed = JSON.parse(rawBody) as NativeWorkspaceStateEnvelope;
    } catch {
      if (!response.ok) {
        throw new Error(rawBody || `Workspace state request failed with ${response.status}.`);
      }
    }

    if (!response.ok || !parsed?.ok || !parsed.result) {
      throw new Error(parsed?.error ?? (rawBody || `Workspace state request failed with ${response.status}.`));
    }

    return parsed.result;
  }

  async function openNativeDirectoryDialog(defaultPath?: string, title?: string) {
    const response = await requestLocalServer('/dialog/open-directory', 'POST', {
      defaultPath,
      title,
    });
    const rawBody = await response.text();
    let parsed: ToolInvokeResponse | OpenDirectoryDialogResult | null = null;

    try {
      parsed = JSON.parse(rawBody) as ToolInvokeResponse | OpenDirectoryDialogResult;
    } catch {
      if (!response.ok) {
        throw new Error(rawBody || `Open directory dialog failed with ${response.status}.`);
      }
    }

    if (!response.ok) {
      const message =
        parsed && 'error' in parsed && typeof parsed.error === 'string'
          ? parsed.error
          : rawBody || `Open directory dialog failed with ${response.status}.`;
      throw new Error(message);
    }

    if (!parsed || !('path' in parsed)) {
      return null;
    }

    return typeof parsed.path === 'string' && parsed.path.trim() ? parsed.path : null;
  }

  async function saveNativeWorkspaceState(
    workspaceState: PersistedWorkspaceState,
    nextLocale: Locale,
    nextThemeMode: ThemeMode,
  ): Promise<NativeWorkspaceStateResult> {
    const response = await requestLocalServer('/state/workspace', 'POST', {
      workspaceState,
      locale: nextLocale,
      themeMode: nextThemeMode,
    });
    const rawBody = await response.text();
    let parsed: NativeWorkspaceStateEnvelope | null = null;

    try {
      parsed = JSON.parse(rawBody) as NativeWorkspaceStateEnvelope;
    } catch {
      if (!response.ok) {
        throw new Error(rawBody || `Workspace state save failed with ${response.status}.`);
      }
    }

    if (!response.ok || !parsed?.ok || !parsed.result) {
      throw new Error(parsed?.error ?? (rawBody || `Workspace state save failed with ${response.status}.`));
    }

    return parsed.result;
  }

  async function loadNativeProviderConfig(): Promise<NativeProviderConfigResult> {
    const response = await requestLocalServer('/config/providers', 'GET');
    const rawBody = await response.text();
    let parsed: NativeProviderConfigEnvelope | null = null;

    try {
      parsed = JSON.parse(rawBody) as NativeProviderConfigEnvelope;
    } catch {
      if (!response.ok) {
        throw new Error(rawBody || `Provider config request failed with ${response.status}.`);
      }
    }

    if (!response.ok || !parsed?.ok || !parsed.result) {
      throw new Error(parsed?.error ?? (rawBody || `Provider config request failed with ${response.status}.`));
    }

    return parsed.result;
  }

  async function saveNativeProviderConfig(
    connections: ProviderConnection[],
    nextOpenAiConfigText: string,
  ): Promise<NativeProviderConfigResult> {
    const response = await requestLocalServer('/config/providers', 'POST', {
      connections,
      openAiConfigText: nextOpenAiConfigText,
    });
    const rawBody = await response.text();
    let parsed: NativeProviderConfigEnvelope | null = null;

    try {
      parsed = JSON.parse(rawBody) as NativeProviderConfigEnvelope;
    } catch {
      if (!response.ok) {
        throw new Error(rawBody || `Provider config save failed with ${response.status}.`);
      }
    }

    if (!response.ok || !parsed?.ok || !parsed.result) {
      throw new Error(parsed?.error ?? (rawBody || `Provider config save failed with ${response.status}.`));
    }

    return parsed.result;
  }

  async function invokeToolServer(name: string, args: Record<string, unknown>): Promise<ToolInvokeResponse> {
    try {
      const nextArgs = { ...args };

      if (name === 'run_command') {
        nextArgs.cwd = resolveToolPath(typeof args.cwd === 'string' ? args.cwd : getSessionRootPath());
      }

      if (name === 'read_file' || name === 'write_file' || name === 'patch_file') {
        if (typeof args.path === 'string') {
          nextArgs.path = resolveToolPath(args.path);
        }
      }

      const response = await fetchLocalServer('/invoke', {
        tool: name,
        args: nextArgs,
      });

      const data = (await response.json()) as ToolInvokeResponse;
      if (!response.ok) {
        return {
          ok: false,
          error: data.error ?? `Tool server returned ${response.status}.`,
        };
      }

      return data;
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error ? error.message : buildLocalServerUnavailableMessage(String(error)),
      };
    }
  }

  function buildLocalModelRequest(
    preparedRequest: PreparedProviderRequest,
    providerConnection: ProviderConnection,
  ): LocalModelRequest {
    return {
      providerId: preparedRequest.providerId,
      baseUrl: providerConnection.endpoint,
      apiKey: providerConnection.apiKey,
      payload: preparedRequest.body,
    };
  }

  async function invokeLocalModelCompletion(
    preparedRequest: PreparedProviderRequest,
    providerConnection: ProviderConnection,
  ): Promise<LocalModelResult> {
    const response = await fetchLocalServer('/chat', buildLocalModelRequest(preparedRequest, providerConnection));

    const rawBody = await response.text();
    let parsed: LocalModelEnvelope | null = null;

    try {
      parsed = JSON.parse(rawBody) as LocalModelEnvelope;
    } catch {
      if (!response.ok) {
        throw new Error(rawBody || `Local model server request failed with ${response.status}.`);
      }
    }

    if (!response.ok || !parsed?.ok || !parsed.result) {
      throw new Error(parsed?.error ?? (rawBody || `Local model server request failed with ${response.status}.`));
    }

    return parsed.result;
  }

  async function streamLocalModelService(
    preparedRequest: PreparedProviderRequest,
    providerConnection: ProviderConnection,
    requestId: string,
  ) {
    const response = await fetchLocalServer(
      '/chat/stream',
      buildLocalModelRequest(preparedRequest, providerConnection),
    );

    const reader = response.body?.getReader();
    if (!response.ok) {
      const rawBody = await response.text();
      throw new Error(rawBody);
    }

    if (!reader) {
      throw new Error('No response stream available.');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) {
          continue;
        }

        const payload = line.slice(5).trim();
        if (!payload) {
          continue;
        }

        const event = JSON.parse(payload) as LocalModelStreamEvent;
        if (event.eventType === 'chunk' && event.text) {
          appendResponseChunk(requestId, event.text);
          continue;
        }

        if (event.eventType === 'done') {
          if (event.rawResponseText) {
            setDebugRequestRawResponse(requestId, event.rawResponseText);
          }
          return;
        }

        if (event.eventType === 'error') {
          throw new Error(event.message ?? 'Local model stream failed.');
        }
      }
    }
  }

  async function runOpenAiCodingAgentLoop(
    providerConnection: ProviderConnection,
    prompt: string,
    placeholderId: string,
    startedAt: string,
  ) {
    const toolSpecs = buildEnabledOpenAiTools(state.tools);
    const transport: TransportKind = isTauriRuntime() ? 'tauri' : 'browser';
    const messages: Array<Record<string, unknown>> = [
      {
        role: 'system',
        content: SYSTEM_PROMPT,
      },
      ...buildContextMessages(state.transcript, prompt),
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const preparedRequest =
        round === 0
          ? buildOpenAiAgentRequest(state.selectedProvider, providerConnection, state.transcript, prompt, toolSpecs)
          : buildOpenAiFollowUpRequest(state.selectedProvider, providerConnection, messages, toolSpecs);
      const requestId = `${placeholderId}-tool-round-${round + 1}`;
      startDebugRequest(requestId, preparedRequest, transport, startedAt);

      let result: LocalModelResult;
      try {
        result = await invokeLocalModelCompletion(preparedRequest, providerConnection);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        markDebugRequestError(requestId, message);
        throw new Error(message);
      }

      if (result.rawResponseText) {
        setDebugRequestRawResponse(requestId, result.rawResponseText);
      }

      const assistantText = result.content ?? '';
      const toolCalls = normalizeOpenAiToolCalls(Array.isArray(result.toolCalls) ? result.toolCalls : []);
      completeDebugRequest(requestId, assistantText.length);

      if (!toolCalls.length) {
        replaceTranscriptBody(placeholderId, assistantText || ' ');
        return;
      }

      messages.push(buildAssistantToolMessage(assistantText, toolCalls));

      for (const toolCall of toolCalls) {
        const toolName = toolCall.function?.name?.trim() ?? '';
        const toolCallId = toolCall.id || `tool-call-${round + 1}-${crypto.randomUUID()}`;
        let parsedArgs: Record<string, unknown> = {};
        let toolResponse: ToolInvokeResponse;

        if (!toolName) {
          toolResponse = {
            ok: false,
            error: 'Model returned an empty tool name.',
          };
          {
            const toolResult = summarizeToolResult('tool-error', toolResponse);
            appendTranscript('tool', 'tool-error', toolResult.summary, toolResult.detail);
          }
          messages.push({
            role: 'tool',
            tool_call_id: toolCallId,
            content: JSON.stringify(toolResponse),
          });
          continue;
        }

        try {
          parsedArgs = toolCall.function.arguments
            ? (JSON.parse(toolCall.function.arguments) as Record<string, unknown>)
            : {};
        } catch {
          toolResponse = {
            ok: false,
            error: `Tool arguments for '${toolName}' were not valid JSON.`,
          };
          {
            const toolResult = summarizeToolResult(toolName, toolResponse);
            appendTranscript('tool', toolName, toolResult.summary, toolResult.detail);
          }
          messages.push({
            role: 'tool',
            tool_call_id: toolCallId,
            content: JSON.stringify(toolResponse),
          });
          continue;
        }

        toolResponse = await invokeToolServer(toolName, parsedArgs);
        {
          const toolResult = summarizeToolResult(toolName, toolResponse);
          appendTranscript('tool', toolName, toolResult.summary, toolResult.detail);
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCallId,
          content: JSON.stringify(toolResponse),
        });
      }
    }

    const finalMessages = [
      ...messages,
      {
        role: 'user',
        content:
          'Stop using tools. Summarize exactly what you changed, list the key files or commands involved, mention any remaining gap briefly, and provide the final answer now.',
      },
    ];
    const finalRequest = buildOpenAiFollowUpRequest(
      state.selectedProvider,
      providerConnection,
      finalMessages,
      [],
    );
    const finalRequestId = `${placeholderId}-tool-round-final`;
    startDebugRequest(finalRequestId, finalRequest, transport, startedAt);

    try {
      replaceTranscriptBody(placeholderId, '');
      await streamLocalModelService(finalRequest, providerConnection, placeholderId);
      completeDebugRequest(finalRequestId);
      return;
    } catch (error) {
      const message = truncateErrorMessage(error instanceof Error ? error.message : String(error));
      markDebugRequestError(finalRequestId, message);
      throw new Error(`Exceeded ${MAX_TOOL_ROUNDS} tool rounds without a final answer. ${message}`);
    }
  }

  async function streamBrowserOpenAi(request: PreparedProviderRequest, requestId: string) {
    const response = await fetch(request.endpoint, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
    });

    if (!response.ok) {
      const rawBody = await response.text();
      setDebugRequestRawResponse(requestId, rawBody);
      throw new Error(rawBody);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response stream available.');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) {
          continue;
        }

        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') {
          continue;
        }

        const parsed = JSON.parse(payload) as {
          choices?: Array<{
            delta?: { content?: string | Array<{ text?: string }> };
          }>;
        };
        const content = parsed.choices?.[0]?.delta?.content;

        if (typeof content === 'string' && content) {
          appendResponseChunk(requestId, content);
          continue;
        }

        if (Array.isArray(content)) {
          const textChunk = content.map((item) => item.text ?? '').join('');
          if (textChunk) {
            appendResponseChunk(requestId, textChunk);
          }
        }
      }
    }
  }

  async function streamBrowserAnthropic(request: PreparedProviderRequest, requestId: string) {
    const response = await fetch(request.endpoint, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
    });

    if (!response.ok) {
      const rawBody = await response.text();
      setDebugRequestRawResponse(requestId, rawBody);
      throw new Error(rawBody);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response stream available.');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) {
          continue;
        }

        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') {
          continue;
        }

        const parsed = JSON.parse(payload) as { type?: string; delta?: { text?: string } };
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          appendResponseChunk(requestId, parsed.delta.text);
        }
      }
    }
  }

  async function streamBrowserProvider(request: PreparedProviderRequest, requestId: string) {
    if (request.providerId === 'openai' || request.providerId === 'opencode') {
      await streamBrowserOpenAi(request, requestId);
      return;
    }

    if (request.providerId === 'anthropic') {
      await streamBrowserAnthropic(request, requestId);
      return;
    }

    throw new Error('Current provider is not yet supported in web mode.');
  }

  async function sendPrompt() {
    if (!draft.trim() || streaming) {
      return;
    }

    if (!providerConfigLoaded) {
      appendTranscript('system', text.requestFailed, text.providerConfigLoading);
      return;
    }

    const providerConnection = resolveEffectiveProviderConnection(
      state.providerConnections.find(
        (connection) => connection.providerId === state.selectedProvider,
      ),
      parsedOpenAiConfig,
    );

    if (!providerConnection?.enabled || !providerConnection.connected) {
      appendTranscript('system', text.requestFailed, text.providerDisabled);
      return;
    }

    if (!providerConnection.apiKey.trim()) {
      appendTranscript('system', text.requestFailed, text.missingKey);
      return;
    }

    if (!providerConnection.selectedModel.trim()) {
      appendTranscript('system', text.requestFailed, text.missingModel);
      return;
    }

    const userEntry = createEntry('user', text.promptQueued, draft.trim());
    const placeholderId = crypto.randomUUID();
    const prompt = draft.trim();
    const transport: TransportKind = isTauriRuntime() ? 'tauri' : 'browser';
    const useCodingToolLoop =
      providerSupportsCodingTools(state.selectedProvider) && buildEnabledOpenAiTools(state.tools).length > 0;
    let preparedRequest: PreparedProviderRequest | null = null;

    if (!useCodingToolLoop) {
      try {
        preparedRequest = buildPreparedProviderRequest(
          state.selectedProvider,
          providerConnection,
          state.transcript,
          prompt,
        );
      } catch (error) {
        appendTranscript(
          'system',
          text.requestFailed,
          error instanceof Error ? error.message : String(error),
        );
        return;
      }
    }

    setState((current) => ({
      ...current,
      transcript: [
        ...current.transcript,
        userEntry,
        {
          id: placeholderId,
          role: 'assistant',
          title: text.streamingResponse,
          body: '',
          timestamp: userEntry.timestamp,
        },
      ],
    }));

    setStreaming(true);
    setDraft('');

    try {
      if (useCodingToolLoop) {
        await runOpenAiCodingAgentLoop(providerConnection, prompt, placeholderId, userEntry.timestamp);
        setStreaming(false);
      } else if (preparedRequest) {
        startDebugRequest(placeholderId, preparedRequest, transport, userEntry.timestamp);
        await streamLocalModelService(preparedRequest, providerConnection, placeholderId);
        completeDebugRequest(placeholderId);
        setStreaming(false);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      replaceTranscriptBody(placeholderId, `${text.requestFailed}: ${message}`);
      if (!useCodingToolLoop) {
        markDebugRequestError(placeholderId, `${text.requestFailed}: ${message}`);
      }
      setStreaming(false);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendPrompt();
    }
  }

  const enabledTools = state.tools.filter((tool) => tool.enabled).length;
  const activeServers = state.mcpServers.filter((server) => server.enabled).length;

  return (
    <div className="app-shell">
      <aside className="workspace-sidebar panel">
        <div className="sidebar-top">
          <p className="eyebrow">{text.appLabel}</p>
          <h2>{text.sessions}</h2>
          <button className="sidebar-primary" onClick={() => void chooseSystemDirectory()} type="button">
            {text.newSession}
          </button>
          <button className="sidebar-secondary" onClick={clearCurrentSession} type="button">
            {text.clearSession}
          </button>
        </div>

        <div className="session-card">
          <span className="eyebrow">{text.currentSession}</span>
          <strong>{activeProvider.name}</strong>
          <p>{activeConnection?.selectedModel ?? activeProvider.activeModel}</p>
          <p>{text.workingDirectory}: {state.workingDirectory || '.'}</p>
        </div>

        <div className="sidebar-bottom">
          <div className="sidebar-actions">
            <button className="settings-launcher" onClick={() => setShowDebug(true)} type="button">
              <span>{text.debug}</span>
              <small>{text.requestHistory}</small>
            </button>
            <button className="settings-launcher" onClick={() => setShowSettings(true)} type="button">
              <span>{text.settings}</span>
              <small>{text.providerSection}</small>
            </button>
          </div>
        </div>
      </aside>

      <main className="center-stage panel">
        <section className="transcript" ref={transcriptRef}>
          {state.transcript.map((entry) => (
            <article key={entry.id} className={`chat-row ${entry.role}`}>
              <div className={`chat-bubble ${entry.role}`}>
                {(() => {
                  const body = entry.body || (streaming && entry.title === text.streamingResponse ? '...' : '');

                  return (
                    <>
                      {entry.role === 'system' || entry.role === 'tool' ? (
                        <div className="transcript-meta">
                          <span>{roleLabel(entry.role, locale)}</span>
                          <time>{entry.timestamp}</time>
                        </div>
                      ) : null}
                      <h3 className="chat-title">{entry.title}</h3>
                      {entry.role === 'assistant' ? (
                        <MarkdownContent content={body} />
                      ) : entry.role === 'tool' && entry.detail ? (
                        <details className="tool-call-card">
                          <summary className="tool-call-summary">
                            <span className="tool-call-summary-text">{body}</span>
                            <span className="tool-call-summary-action">Details</span>
                          </summary>
                          {entry.detail ? <pre className="tool-call-detail">{entry.detail}</pre> : null}
                        </details>
                      ) : (
                        <p className="chat-plain-text">{body}</p>
                      )}
                      {entry.role === 'user' || entry.role === 'assistant' ? (
                        <time className="chat-hover-time">{entry.timestamp}</time>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            </article>
          ))}
        </section>

        <footer className="composer">
          <div className="composer-shell">
            <div className="composer-main">
              <textarea
                aria-label="Prompt composer"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder={text.promptPlaceholder}
              />
              <div className="composer-main-footer">
                <div className="composer-main-meta">
                  <div className="composer-toolbar composer-toolbar-inline">
                    <label className="composer-provider-picker">
                      <span>{text.chooseModel}</span>
                      <select
                        className="composer-select"
                        value={activeConnection?.selectedModel ?? ''}
                        onChange={(event) => setProviderModel(state.selectedProvider, event.target.value)}
                      >
                        {(effectiveProviderPresets[state.selectedProvider] ?? []).map((preset: ProviderModelPreset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className={`badge composer-inline-badge ${streaming ? 'live' : 'idle'}`}>
                      {streaming ? text.streaming : text.ready}
                    </span>
                    <label className="composer-provider-picker narrow-picker">
                      <span>{text.chooseVariant}</span>
                      <select
                        className="composer-select"
                        value={activeConnection?.selectedVariant ?? 'medium'}
                        onChange={(event) => setProviderVariant(state.selectedProvider, event.target.value as ModelVariant)}
                      >
                        {(getProviderPreset(
                          effectiveProviderPresets,
                          state.selectedProvider,
                          activeConnection?.selectedModel ?? '',
                        )?.variants ?? ['medium']).map((variant) => (
                          <option key={variant} value={variant}>
                            {variant}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {visibleProviders.length > 1 ? (
              <div className="composer-toolbar composer-toolbar-standalone">
                <label className="composer-provider-picker">
                  <span>{text.chooseProvider}</span>
                  <select
                    className="composer-select"
                    value={state.selectedProvider}
                    onChange={(event) => setProvider(event.target.value as ProviderId)}
                  >
                    {visibleProviders.map((provider) => {
                      const connection = state.providerConnections.find((item) => item.providerId === provider.id);
                      return (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                          {connection?.connected ? '' : ' · offline'}
                        </option>
                      );
                    })}
                  </select>
                </label>
              </div>
            ) : null}
          </div>
        </footer>
      </main>

      {showDebug ? (
        <div className="settings-modal-backdrop" onClick={() => setShowDebug(false)} role="presentation">
          <aside
            className="settings-modal debug-modal panel"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={text.debugTitle}
          >
            <div className="settings-modal-header">
              <div>
                <p className="eyebrow">{text.debug}</p>
                <h2>{text.debugTitle}</h2>
                <p className="helper-text debug-subtitle">{text.debugSubtitle}</p>
              </div>
              <div className="debug-header-actions">
                {state.debugRequests.length ? (
                  <button className="secondary-button" onClick={clearDebugRequests} type="button">
                    {text.clearDebug}
                  </button>
                ) : null}
                <button className="secondary-button" onClick={() => setShowDebug(false)} type="button">
                  {text.closeDebug}
                </button>
              </div>
            </div>

            <div className="settings-list">
              {orderedDebugRequests.length ? (
                <div className="debug-layout">
                  <section className="settings-card debug-history-pane">
                    <div className="stats-grid debug-stats-grid">
                      <div className="stat-card">
                        <span>{text.contextPolicy}</span>
                        <strong>{text.contextPolicyValue(MAX_CONTEXT_MESSAGES)}</strong>
                      </div>
                      <div className="stat-card">
                        <span>{text.requestHistory}</span>
                        <strong>{state.debugRequests.length}</strong>
                      </div>
                    </div>

                    <div className="debug-history-list">
                      {orderedDebugRequests.map((entry) => {
                        const statusLabel =
                          entry.status === 'done'
                            ? text.statusDone
                            : entry.status === 'error'
                              ? text.statusError
                              : text.statusPending;
                        const providerName =
                          providerProfiles.find((provider) => provider.id === entry.providerId)?.name ?? entry.providerId;

                        return (
                          <button
                            key={entry.id}
                            className={`settings-card debug-request-card debug-request-selectable ${selectedDebugRequest?.id === entry.id ? 'selected' : ''}`}
                            onClick={() => setSelectedDebugRequestId(entry.id)}
                            type="button"
                          >
                            <div className="debug-request-header">
                              <div>
                                <strong>
                                  {providerName} · {entry.model}
                                </strong>
                                <p className="helper-text">
                                  {entry.endpoint}
                                </p>
                              </div>
                              <div className="provider-badges debug-request-badges">
                                <span
                                  className={`badge ${entry.status === 'error' ? 'idle' : entry.status === 'done' ? 'live' : 'idle'}`}
                                >
                                  {statusLabel}
                                </span>
                                <span className="badge idle">
                                  {text.transportLabel}: {entry.transport}
                                </span>
                              </div>
                            </div>

                            <div className="debug-request-grid">
                              <div className="limit-card debug-metric">
                                {text.historyMessages}: {entry.historyMessageCount}
                              </div>
                              <div className="limit-card debug-metric">
                                {text.payloadMessages}: {entry.payloadMessageCount}
                              </div>
                              <div className="limit-card debug-metric">
                                {text.outputChars}: {entry.outputChars}
                              </div>
                              <div className="limit-card debug-metric">
                                {text.durationLabel}: {entry.durationMs ? `${entry.durationMs} ms` : '—'}
                              </div>
                            </div>

                            <p className="helper-text debug-request-timestamp">
                              {entry.startedAt}
                              {entry.variant ? ` · ${entry.variant}` : ''}
                              {entry.inputChars ? ` · in ${entry.inputChars}` : ''}
                            </p>

                            {entry.error ? (
                              <p className="debug-request-error">{entry.error}</p>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section className="settings-card debug-payload-pane">
                    {selectedDebugRequest ? (
                      (() => {
                        const providerName =
                          providerProfiles.find((provider) => provider.id === selectedDebugRequest.providerId)?.name ??
                          selectedDebugRequest.providerId;
                        const statusLabel =
                          selectedDebugRequest.status === 'done'
                            ? text.statusDone
                            : selectedDebugRequest.status === 'error'
                              ? text.statusError
                              : text.statusPending;

                        return (
                          <>
                            <div className="debug-payload-header">
                              <div>
                                <p className="eyebrow">{text.requestPayload}</p>
                                <h3>
                                  {providerName} · {selectedDebugRequest.model}
                                </h3>
                                <p className="helper-text">{selectedDebugRequest.endpoint}</p>
                              </div>
                              <div className="provider-badges debug-request-badges">
                                <span
                                  className={`badge ${selectedDebugRequest.status === 'error' ? 'idle' : selectedDebugRequest.status === 'done' ? 'live' : 'idle'}`}
                                >
                                  {statusLabel}
                                </span>
                                <span className="badge idle">
                                  {text.transportLabel}: {selectedDebugRequest.transport}
                                </span>
                              </div>
                            </div>

                            <div className="debug-request-grid debug-payload-meta">
                              <div className="limit-card debug-metric">
                                {text.historyMessages}: {selectedDebugRequest.historyMessageCount}
                              </div>
                              <div className="limit-card debug-metric">
                                {text.payloadMessages}: {selectedDebugRequest.payloadMessageCount}
                              </div>
                              <div className="limit-card debug-metric">
                                {text.outputChars}: {selectedDebugRequest.outputChars}
                              </div>
                              <div className="limit-card debug-metric">
                                {text.durationLabel}: {selectedDebugRequest.durationMs ? `${selectedDebugRequest.durationMs} ms` : '—'}
                              </div>
                            </div>

                            <p className="helper-text debug-request-timestamp">
                              {selectedDebugRequest.startedAt}
                              {selectedDebugRequest.variant ? ` · ${selectedDebugRequest.variant}` : ''}
                              {selectedDebugRequest.inputChars ? ` · in ${selectedDebugRequest.inputChars}` : ''}
                            </p>

                            {selectedDebugRequest.error ? (
                              <p className="debug-request-error">{selectedDebugRequest.error}</p>
                            ) : null}

                            <div className="debug-detail-tabs" role="tablist" aria-label={text.debugTitle}>
                              <button
                                className={`debug-detail-tab ${debugDetailTab === 'request' ? 'active' : ''}`}
                                onClick={() => setDebugDetailTab('request')}
                                role="tab"
                                type="button"
                              >
                                {text.requestPayload}
                              </button>
                              <button
                                className={`debug-detail-tab ${debugDetailTab === 'response' ? 'active' : ''}`}
                                onClick={() => setDebugDetailTab('response')}
                                role="tab"
                                type="button"
                              >
                                {text.rawResponse}
                              </button>
                            </div>

                            <pre className="debug-request-pre debug-payload-pre">
                              {debugDetailTab === 'request'
                                ? selectedDebugRequest.requestJson
                                : selectedDebugRequest.rawResponseText || text.noRawResponse}
                            </pre>
                          </>
                        );
                      })()
                    ) : (
                      <p className="helper-text debug-payload-empty">{text.noDebugRequests}</p>
                    )}
                  </section>
                </div>
              ) : (
                <div className="settings-card">
                  <p className="helper-text">{text.noDebugRequests}</p>
                </div>
              )}
            </div>
          </aside>
        </div>
      ) : null}

      {showSettings ? (
        <div className="settings-modal-backdrop" onClick={() => setShowSettings(false)} role="presentation">
          <aside
            className="settings-modal panel"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={text.providerPageTitle}
          >
            <div className="settings-modal-header">
              <div>
                <p className="eyebrow">{text.settings}</p>
                <h2>{text.providerPageTitle}</h2>
              </div>
              <button className="secondary-button" onClick={() => setShowSettings(false)} type="button">
                {text.closeSettings}
              </button>
            </div>

            <div className="settings-layout">
              <aside className="settings-sidebar">
                <p className="eyebrow">{text.settingsOverview}</p>
                <button
                  className={`settings-nav-item ${settingsSection === 'openai' ? 'active' : ''}`}
                  onClick={() => setSettingsSection('openai')}
                  type="button"
                >
                  <strong>{text.openaiConfig}</strong>
                  <span>{text.openaiConfigDesc}</span>
                </button>
                <button
                  className={`settings-nav-item ${settingsSection === 'claude' ? 'active' : ''}`}
                  onClick={() => setSettingsSection('claude')}
                  type="button"
                >
                  <strong>{text.claudeConfig}</strong>
                  <span>{text.claudeConfigDesc}</span>
                </button>
                <button
                  className={`settings-nav-item ${settingsSection === 'tools' ? 'active' : ''}`}
                  onClick={() => setSettingsSection('tools')}
                  type="button"
                >
                  <strong>{text.toolsConfig}</strong>
                  <span>{text.toolsConfigDesc}</span>
                </button>
                <button
                  className={`settings-nav-item ${settingsSection === 'appearance' ? 'active' : ''}`}
                  onClick={() => setSettingsSection('appearance')}
                  type="button"
                >
                  <strong>{text.appearanceConfig}</strong>
                  <span>{text.appearanceConfigDesc}</span>
                </button>
              </aside>

              <section className="settings-content">
                <p className="helper-text settings-intro">
                  {settingsSection === 'appearance'
                    ? text.appearanceHint
                    : settingsSection === 'tools'
                      ? text.toolsHint
                      : text.providerConfigHint}
                </p>
                <div className="settings-list">
                  {settingsSection === 'openai' ? (() => {
                    const connection = state.providerConnections.find((item) => item.providerId === 'openai');
                    if (!connection) return null;
                    const presets = effectiveProviderPresets.openai ?? [];
                    const selectedPreset = getProviderPreset(effectiveProviderPresets, 'openai', connection.selectedModel);

                    return (
                      <div className="settings-card">
                        <div className="section-head compact">
                          <strong>{text.openaiConfig}</strong>
                          <div className="provider-badges">
                            <span className={`badge ${connection.enabled ? 'live' : 'idle'}`}>
                              {connection.enabled ? text.enabled : text.disabled}
                            </span>
                            <span className={`badge ${connection.connected ? 'live' : 'idle'}`}>
                              {connection.connected ? text.connected : text.disconnected}
                            </span>
                          </div>
                        </div>

                        <div className="settings-actions openai-config-actions">
                          <button className="secondary-button" onClick={() => setShowOpenAiJsonEditor((current) => !current)} type="button">
                            {text.editJson}
                          </button>
                          <button className="secondary-button" onClick={applyOpenAiJsonConfig} type="button">
                            {text.saveJson}
                          </button>
                        </div>

                        {showOpenAiJsonEditor ? (
                          <label className="field-label">
                            <span>{text.rawConfig}</span>
                            <textarea
                              className="config-editor"
                              value={openAiConfigText}
                              onChange={(event) => setOpenAiConfigText(event.target.value)}
                            />
                          </label>
                        ) : null}

                        <label className="field-label">
                          <span>{text.endpoint}</span>
                          <input
                            className="text-input"
                            value={connection.endpoint}
                            onChange={(event) => updateProviderConnection('openai', { endpoint: event.target.value })}
                          />
                        </label>

                        <label className="field-label">
                          <span>{text.apiKey}</span>
                          <input
                            className="text-input"
                            type="password"
                            placeholder={maskApiKey(connection.apiKey)}
                            value={connection.apiKey}
                            onChange={(event) => updateProviderConnection('openai', { apiKey: event.target.value })}
                          />
                        </label>

                        <label className="field-label">
                          <span>{text.model}</span>
                          <select
                            className="text-input themed-select"
                            value={connection.selectedModel}
                            onChange={(event) => setProviderModel('openai', event.target.value)}
                          >
                            {presets.map((preset: ProviderModelPreset) => (
                              <option key={preset.id} value={preset.id}>
                                {preset.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        <div className="field-grid">
                          <label className="field-label">
                            <span>{text.variant}</span>
                            <select
                              className="text-input themed-select"
                              value={connection.selectedVariant}
                              onChange={(event) => setProviderVariant('openai', event.target.value as ModelVariant)}
                            >
                              {(selectedPreset?.variants ?? ['medium']).map((variant) => (
                                <option key={variant} value={variant}>
                                  {variant}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="field-label">
                            <span>{text.limits}</span>
                            <div className="limit-card">
                              {selectedPreset
                                ? `${selectedPreset.contextLimit.toLocaleString()} / ${selectedPreset.outputLimit.toLocaleString()}`
                                : '—'}
                            </div>
                          </label>
                        </div>

                        <div className="settings-actions top-gap">
                          <label className="inline-toggle">
                            <input
                              checked={connection.store}
                              onChange={() => updateProviderConnection('openai', { store: !connection.store })}
                              type="checkbox"
                            />
                            <span>{text.store}</span>
                          </label>
                          <span className="helper-text inline-value">
                            {text.activeModelLabel}: {connection.selectedModel}
                          </span>
                        </div>

                        <div className="settings-actions">
                          <label className="inline-toggle">
                            <input
                              checked={connection.enabled}
                              onChange={() => toggleProviderEnabled('openai')}
                              type="checkbox"
                            />
                            <span>{connection.enabled ? text.enabled : text.disabled}</span>
                          </label>
                          <button
                            className={`secondary-button ${connection.connected ? 'danger' : ''}`}
                            onClick={() => setProviderConnected('openai', !connection.connected)}
                            type="button"
                          >
                            {connection.connected ? text.disconnect : text.connect}
                          </button>
                        </div>
                      </div>
                    );
                  })() : settingsSection === 'claude' ? (() => {
                    const connection = state.providerConnections.find((item) => item.providerId === 'anthropic');
                    if (!connection) return null;
                    const presets = effectiveProviderPresets.anthropic ?? [];
                    const selectedPreset = getProviderPreset(effectiveProviderPresets, 'anthropic', connection.selectedModel);

                    return (
                      <div className="settings-card">
                        <div className="section-head compact">
                          <strong>{text.claudeConfig}</strong>
                          <div className="provider-badges">
                            <span className={`badge ${connection.enabled ? 'live' : 'idle'}`}>
                              {connection.enabled ? text.enabled : text.disabled}
                            </span>
                            <span className={`badge ${connection.connected ? 'live' : 'idle'}`}>
                              {connection.connected ? text.connected : text.disconnected}
                            </span>
                          </div>
                        </div>

                        <label className="field-label">
                          <span>{text.endpoint}</span>
                          <input
                            className="text-input"
                            value={connection.endpoint}
                            onChange={(event) => updateProviderConnection('anthropic', { endpoint: event.target.value })}
                          />
                        </label>

                        <label className="field-label">
                          <span>{text.apiKey}</span>
                          <input
                            className="text-input"
                            type="password"
                            placeholder={maskApiKey(connection.apiKey)}
                            value={connection.apiKey}
                            onChange={(event) => updateProviderConnection('anthropic', { apiKey: event.target.value })}
                          />
                        </label>

                        <label className="field-label">
                          <span>{text.model}</span>
                          <select
                            className="text-input themed-select"
                            value={connection.selectedModel}
                            onChange={(event) => setProviderModel('anthropic', event.target.value)}
                          >
                            {presets.map((preset: ProviderModelPreset) => (
                              <option key={preset.id} value={preset.id}>
                                {preset.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        <div className="field-grid">
                          <label className="field-label">
                            <span>{text.variant}</span>
                            <select
                              className="text-input themed-select"
                              value={connection.selectedVariant}
                              onChange={(event) => setProviderVariant('anthropic', event.target.value as ModelVariant)}
                            >
                              {(selectedPreset?.variants ?? ['medium']).map((variant) => (
                                <option key={variant} value={variant}>
                                  {variant}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="field-label">
                            <span>{text.limits}</span>
                            <div className="limit-card">
                              {selectedPreset
                                ? `${selectedPreset.contextLimit.toLocaleString()} / ${selectedPreset.outputLimit.toLocaleString()}`
                                : '—'}
                            </div>
                          </label>
                        </div>

                        <div className="settings-actions top-gap">
                          <label className="inline-toggle">
                            <input
                              checked={connection.store}
                              onChange={() => updateProviderConnection('anthropic', { store: !connection.store })}
                              type="checkbox"
                            />
                            <span>{text.store}</span>
                          </label>
                          <span className="helper-text inline-value">
                            {text.activeModelLabel}: {connection.selectedModel}
                          </span>
                        </div>

                        <div className="settings-actions">
                          <label className="inline-toggle">
                            <input
                              checked={connection.enabled}
                              onChange={() => toggleProviderEnabled('anthropic')}
                              type="checkbox"
                            />
                            <span>{connection.enabled ? text.enabled : text.disabled}</span>
                          </label>
                          <button
                            className={`secondary-button ${connection.connected ? 'danger' : ''}`}
                            onClick={() => setProviderConnected('anthropic', !connection.connected)}
                            type="button"
                          >
                            {connection.connected ? text.disconnect : text.connect}
                          </button>
                        </div>
                      </div>
                    );
                  })() : settingsSection === 'tools' ? (
                    <div className="settings-card">
                      <div className="section-head compact">
                        <strong>{text.toolsConfig}</strong>
                        <div className="provider-badges">
                          <span className="badge live">
                            {enabledTools} / {state.tools.length}
                          </span>
                        </div>
                      </div>

                      <div className="tool-settings-list">
                        {state.tools.map((tool) => {
                          const functions = TOOL_FUNCTIONS[tool.id] ?? [];

                          return (
                            <div key={tool.id} className="tool-settings-card">
                              <div className="tool-settings-header">
                                <div>
                                  <strong>{tool.name}</strong>
                                  <p className="helper-text">{tool.description}</p>
                                </div>
                                <div className="provider-badges">
                                  <span className={`badge ${tool.enabled ? 'live' : 'idle'}`}>
                                    {tool.enabled ? text.enabled : text.disabled}
                                  </span>
                                  <span className="badge idle">
                                    {text.toolCategory}: {tool.category}
                                  </span>
                                </div>
                              </div>

                              <div className="tool-settings-meta">
                                <div className="tool-settings-meta-card">
                                  <span>{text.toolStatus}</span>
                                  <strong>{tool.enabled ? text.enabled : text.disabled}</strong>
                                </div>
                                <div className="tool-settings-meta-card">
                                  <span>{text.toolFunctions}</span>
                                  <strong>{functions.length}</strong>
                                </div>
                              </div>

                              <div className="tool-settings-functions">
                                {functions.length ? (
                                  functions.map((toolFunction: ToolFunctionInfo) => (
                                    <details key={toolFunction.name} className="tool-function-card">
                                      <summary className="tool-function-summary">
                                        <div className="tool-function-summary-main">
                                          <code className="tool-function-chip">{toolFunction.name}</code>
                                          <span className="tool-function-desc">{toolFunction.description}</span>
                                        </div>
                                        <span className="tool-function-action">{text.expandDetail}</span>
                                      </summary>
                                      <div className="tool-function-details">
                                        <div className="tool-function-detail-row">
                                          <span>{text.toolFunctionDesc}</span>
                                          <p>{toolFunction.description}</p>
                                        </div>
                                        <div className="tool-function-detail-row">
                                          <span>{text.toolFunctionDetail}</span>
                                          <div className="tool-function-detail-list">
                                            {toolFunction.details.map((detail) => (
                                              <code key={detail} className="tool-function-inline-detail">
                                                {detail}
                                              </code>
                                            ))}
                                          </div>
                                        </div>
                                      </div>
                                    </details>
                                  ))
                                ) : (
                                  <p className="helper-text">{text.noToolFunctions}</p>
                                )}
                              </div>

                              <div className="settings-actions top-gap">
                                <label className="inline-toggle">
                                  <input
                                    checked={tool.enabled}
                                    onChange={() => toggleTool(tool.id)}
                                    type="checkbox"
                                  />
                                  <span>{tool.enabled ? text.enabled : text.disabled}</span>
                                </label>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="settings-card">
                      <div className="section-head compact">
                        <strong>{text.appearanceConfig}</strong>
                      </div>

                      <div className="theme-grid">
                        <button
                          className={`theme-card ${themeMode === 'dark' ? 'active' : ''}`}
                          onClick={() => setThemeMode('dark')}
                          type="button"
                        >
                          <strong>{text.darkTheme}</strong>
                          <span>Dark charcoal, quiet contrast.</span>
                        </button>
                        <button
                          className={`theme-card ${themeMode === 'rust-light' ? 'active' : ''}`}
                          onClick={() => setThemeMode('rust-light')}
                          type="button"
                        >
                          <strong>{text.rustLightTheme}</strong>
                          <span>Warm pale yellow with rust accents.</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
