import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { defaultState, providerModelPresets, providerProfiles } from './data/mock';
import {
  ModelVariant,
  ProviderConnection,
  ProviderId,
  ProviderModelPreset,
  TranscriptEntry,
  WorkspaceState,
} from './types';

const STORAGE_KEY = 'sep-agent-workspace-v0.1';
const LOCALE_KEY = 'sep-agent-workspace-locale';
const OPENAI_CONFIG_KEY = 'sep-openai-config-json';
const THEME_KEY = 'sep-theme';

type Locale = 'zh-CN' | 'en';
type SettingsSection = 'openai' | 'claude' | 'appearance';
type ThemeMode = 'dark' | 'rust-light';

interface StreamPayload {
  requestId: string;
  kind: 'start' | 'chunk' | 'done' | 'error';
  chunk?: string;
  message?: string;
}

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
    currentSession: '当前会话',
    chooseProvider: '当前提供商',
    chooseModel: '当前模型',
    chooseVariant: '推理强度',
    editJson: '直接修改配置 JSON',
    saveJson: '保存配置',
    openaiConfig: 'OpenAI',
    claudeConfig: 'Claude',
    appearanceConfig: '外观',
    rawConfig: '原始配置',
    jsonApplied: 'OpenAI JSON 配置已应用。',
    jsonInvalid: 'JSON 格式无效，无法应用配置。',
    openaiConfigDesc: '兼容 OpenAI / Codex 的 provider 配置',
    claudeConfigDesc: 'Claude 接入与模型配置',
    appearanceConfigDesc: '主题、配色与界面观感',
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
    missingKey: '当前 provider 尚未填写 API Key。',
    missingModel: '当前 provider 尚未选择模型。',
    providerDisabled: '当前 provider 未启用或未连接。',
    unsupportedDev: '当前在浏览器开发模式下，无法直接安全调用桌面端 provider。请用 `just dev` 启动 Tauri 桌面应用。',
    requestFailed: '请求失败',
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
    currentSession: 'Current session',
    chooseProvider: 'Provider',
    chooseModel: 'Model',
    chooseVariant: 'Variant',
    editJson: 'Edit config JSON',
    saveJson: 'Save config',
    openaiConfig: 'OpenAI',
    claudeConfig: 'Claude',
    appearanceConfig: 'Appearance',
    rawConfig: 'Raw config',
    jsonApplied: 'OpenAI JSON config applied.',
    jsonInvalid: 'Invalid JSON format.',
    openaiConfigDesc: 'OpenAI / Codex compatible provider config',
    claudeConfigDesc: 'Claude access and model settings',
    appearanceConfigDesc: 'Theme, color, and interface look',
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
    missingKey: 'The current provider is missing an API key.',
    missingModel: 'The current provider is missing a model selection.',
    providerDisabled: 'The current provider is disabled or disconnected.',
    unsupportedDev: 'This browser-only dev mode cannot safely call desktop providers. Launch the Tauri app with `just dev`.',
    requestFailed: 'Request failed',
  },
} as const;

function createEntry(role: TranscriptEntry['role'], title: string, body: string): TranscriptEntry {
  return {
    id: crypto.randomUUID(),
    role,
    title,
    body,
    timestamp: new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    }),
  };
}

function loadState(): WorkspaceState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return defaultState;
  }

  try {
    const parsed = JSON.parse(raw) as WorkspaceState;
    const mergedConnections = defaultState.providerConnections.map((defaultConnection) => {
      const savedConnection = parsed.providerConnections?.find(
        (connection) => connection.providerId === defaultConnection.providerId,
      );

      return {
        ...defaultConnection,
        ...savedConnection,
      };
    });

    return {
      ...defaultState,
      ...parsed,
      providerConnections: mergedConnections,
    };
  } catch {
    return defaultState;
  }
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

const defaultOpenAiConfigJson = `{
  "provider": {
    "openai": {
      "options": {
        "baseURL": "https://323.vip/v1",
        "apiKey": "sk-0be063fcbb0027297dc41863a8b799730714d1ac"
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

function parseOpenAiConfig(configText: string) {
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
  }));

  return {
    endpoint: openai?.options?.baseURL ?? '',
    apiKey: openai?.options?.apiKey ?? '',
    models,
  };
}

export default function App() {
  const [state, setState] = useState<WorkspaceState>(loadState);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [showSettings, setShowSettings] = useState(true);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('openai');
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === 'rust-light' ? 'rust-light' : 'dark';
  });
  const [openAiConfigText, setOpenAiConfigText] = useState(() =>
    localStorage.getItem(OPENAI_CONFIG_KEY) ?? defaultOpenAiConfigJson,
  );
  const [showOpenAiJsonEditor, setShowOpenAiJsonEditor] = useState(false);
  const [locale, setLocale] = useState<Locale>(() => {
    const stored = localStorage.getItem(LOCALE_KEY);
    return stored === 'en' ? 'en' : 'zh-CN';
  });
  const transcriptRef = useRef<HTMLElement | null>(null);
  const text = copy[locale];

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    localStorage.setItem(LOCALE_KEY, locale);
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    localStorage.setItem(OPENAI_CONFIG_KEY, openAiConfigText);
  }, [openAiConfigText]);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, themeMode);
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let unlisten: (() => void) | undefined;

    void listen<StreamPayload>('chat-stream', (event) => {
      const payload = event.payload;
      setState((current) => ({
        ...current,
        transcript: current.transcript.map((entry) => {
          if (entry.id !== payload.requestId) {
            return entry;
          }

          if (payload.kind === 'chunk') {
            return { ...entry, body: `${entry.body}${payload.chunk ?? ''}` };
          }

          if (payload.kind === 'error') {
            return { ...entry, body: `${text.requestFailed}: ${payload.message ?? ''}` };
          }

          return entry;
        }),
      }));

      if (payload.kind === 'done' || payload.kind === 'error') {
        setStreaming(false);
      }
    }).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => {
      unlisten?.();
    };
  }, [text.requestFailed]);

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

  function appendTranscript(role: TranscriptEntry['role'], title: string, body: string) {
    setState((current) => ({
      ...current,
      transcript: [...current.transcript, createEntry(role, title, body)],
    }));
  }

  function createNewSession() {
    setDraft('');
    setState((current) => ({
      ...current,
      transcript: [
        createEntry(
          'system',
          locale === 'zh-CN' ? '新会话已创建' : 'New session created',
          locale === 'zh-CN'
            ? '会话上下文已清空，当前 provider 与设置保持不变。'
            : 'Transcript was cleared. Current provider and settings were preserved.',
        ),
      ],
    }));
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
    updateProviderConnection(providerId, { connected, enabled: connected ? true : undefined });
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

  function appendChunkToTranscript(requestId: string, chunk: string) {
    setState((current) => ({
      ...current,
      transcript: current.transcript.map((entry) =>
        entry.id === requestId ? { ...entry, body: `${entry.body}${chunk}` } : entry,
      ),
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

  async function streamBrowserOpenAi(
    providerConnection: ProviderConnection,
    prompt: string,
    requestId: string,
  ) {
    const response = await fetch(normalizeEndpoint(providerConnection.endpoint, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${providerConnection.apiKey}`,
      },
      body: JSON.stringify({
        model: providerConnection.selectedModel,
        stream: true,
        store: providerConnection.store,
        reasoning_effort: providerConnection.selectedVariant,
        messages: [
          {
            role: 'system',
            content: 'You are a concise desktop coding assistant. Reply directly to the user request.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(await response.text());
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
          appendChunkToTranscript(requestId, content);
          continue;
        }

        if (Array.isArray(content)) {
          const textChunk = content.map((item) => item.text ?? '').join('');
          if (textChunk) {
            appendChunkToTranscript(requestId, textChunk);
          }
        }
      }
    }
  }

  async function streamBrowserAnthropic(
    providerConnection: ProviderConnection,
    prompt: string,
    requestId: string,
  ) {
    const response = await fetch(normalizeEndpoint(providerConnection.endpoint, '/v1/messages'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': providerConnection.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: providerConnection.selectedModel,
        max_tokens: 800,
        stream: true,
        system: 'You are a concise desktop coding assistant. Reply directly to the user request.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(await response.text());
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
          appendChunkToTranscript(requestId, parsed.delta.text);
        }
      }
    }
  }

  async function streamBrowserProvider(
    providerConnection: ProviderConnection,
    prompt: string,
    requestId: string,
  ) {
    if (state.selectedProvider === 'openai' || state.selectedProvider === 'opencode') {
      await streamBrowserOpenAi(providerConnection, prompt, requestId);
      return;
    }

    if (state.selectedProvider === 'anthropic') {
      await streamBrowserAnthropic(providerConnection, prompt, requestId);
      return;
    }

    throw new Error('Current provider is not yet supported in web mode.');
  }

  async function sendPrompt() {
    if (!draft.trim() || streaming) {
      return;
    }

    const providerConnection = state.providerConnections.find(
      (connection) => connection.providerId === state.selectedProvider,
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
      if (isTauriRuntime()) {
        await invoke('send_chat', {
          request: {
            requestId: placeholderId,
            providerId: state.selectedProvider,
            endpoint: providerConnection.endpoint,
            apiKey: providerConnection.apiKey,
            model: providerConnection.selectedModel,
            variant: providerConnection.selectedVariant,
            store: providerConnection.store,
            prompt,
          },
        });
      } else {
        await streamBrowserProvider(providerConnection, prompt, placeholderId);
        setStreaming(false);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      replaceTranscriptBody(placeholderId, `${text.requestFailed}: ${message}`);
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
          <button className="sidebar-primary" onClick={createNewSession} type="button">
            {text.newSession}
          </button>
        </div>

        <div className="session-card">
          <span className="eyebrow">{text.currentSession}</span>
          <strong>{activeProvider.name}</strong>
          <p>{activeConnection?.selectedModel ?? activeProvider.activeModel}</p>
        </div>

        <div className="sidebar-bottom">
          <button className="settings-launcher" onClick={() => setShowSettings(true)} type="button">
            <span>{text.settings}</span>
            <small>{text.providerSection}</small>
          </button>
        </div>
      </aside>

      <main className="center-stage panel">
        <section className="transcript" ref={transcriptRef}>
          {state.transcript.map((entry) => (
            <article key={entry.id} className={`chat-row ${entry.role}`}>
              <div className={`chat-bubble ${entry.role}`}>
                {entry.role === 'system' || entry.role === 'tool' ? (
                  <div className="transcript-meta">
                    <span>{roleLabel(entry.role, locale)}</span>
                    <time>{entry.timestamp}</time>
                  </div>
                ) : null}
                <h3>{entry.title}</h3>
                <p>{entry.body || (streaming && entry.title === text.streamingResponse ? '...' : '')}</p>
                {entry.role === 'user' || entry.role === 'assistant' ? (
                  <time className="chat-hover-time">{entry.timestamp}</time>
                ) : null}
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
                  {settingsSection === 'appearance' ? text.appearanceHint : text.providerConfigHint}
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
                  })() : (
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
