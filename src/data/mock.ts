import {
  McpServer,
  ProviderConnection,
  ProviderModelPreset,
  ProviderProfile,
  DebugRequestEntry,
  ToolDefinition,
  TranscriptEntry,
  WorkspaceState,
} from '../types';

export const providerProfiles: ProviderProfile[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    tone: 'Deliberate, structured, reliable at long-form execution.',
    strength: 'Primary coding and orchestration.',
    latency: 'Balanced',
    activeModel: 'anthropic/claude-sonnet-4.6',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    tone: 'Principle-driven, sharp at architecture and trade-offs.',
    strength: 'Debugging and reasoning-heavy review.',
    latency: 'Medium',
    activeModel: 'openai/gpt-5.4',
  },
  {
    id: 'google',
    name: 'Google',
    tone: 'Fast, multimodal, good at frontend and retrieval.',
    strength: 'Visual and docs-heavy tasks.',
    latency: 'Fast',
    activeModel: 'google/gemini-3-flash',
  },
  {
    id: 'opencode',
    name: 'OpenCode Bridge',
    tone: 'Adapter layer for compatible external harnesses.',
    strength: 'Bridge mode and fallback routing.',
    latency: 'Variable',
    activeModel: 'opencode/gpt-5.3-codex',
  },
];

export const defaultTools: ToolDefinition[] = [
  {
    id: 'shell',
    name: 'Shell',
    category: 'coding',
    description: 'Run commands for dependencies, tests, builds, scripts, search, and git inside the workspace.',
    enabled: true,
  },
  {
    id: 'editor',
    name: 'Editor',
    category: 'filesystem',
    description: 'Read, write, and patch file content directly when shell is not the right fit.',
    enabled: true,
  },
  {
    id: 'fetch',
    name: 'Web Fetch',
    category: 'network',
    description: 'Pull remote docs and transform them into local context.',
    enabled: false,
  },
];

export const defaultProviderConnections: ProviderConnection[] = [
  {
    providerId: 'anthropic',
    enabled: true,
    connected: true,
    endpoint: 'https://api.anthropic.com',
    apiKey: '',
    selectedModel: 'anthropic/claude-sonnet-4.6',
    selectedVariant: 'medium',
    store: false,
  },
  {
    providerId: 'openai',
    enabled: true,
    connected: false,
    endpoint: 'https://api.openai.com/v1',
    apiKey: '',
    selectedModel: 'gpt-5-codex',
    selectedVariant: 'medium',
    store: false,
  },
  {
    providerId: 'google',
    enabled: false,
    connected: false,
    endpoint: 'https://generativelanguage.googleapis.com',
    apiKey: '',
    selectedModel: 'google/gemini-3-flash',
    selectedVariant: 'medium',
    store: false,
  },
  {
    providerId: 'opencode',
    enabled: true,
    connected: false,
    endpoint: 'http://127.0.0.1:4096',
    apiKey: '',
    selectedModel: 'gpt-5.3-codex',
    selectedVariant: 'medium',
    store: false,
  },
];

export const providerModelPresets: Record<string, ProviderModelPreset[]> = {
  openai: [
    { id: 'gpt-5-codex', name: 'GPT-5 Codex', contextLimit: 400000, outputLimit: 128000, variants: ['low', 'medium', 'high'] },
    { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex', contextLimit: 400000, outputLimit: 128000, variants: ['low', 'medium', 'high'] },
    { id: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max', contextLimit: 400000, outputLimit: 128000, variants: ['low', 'medium', 'high'] },
    { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini', contextLimit: 400000, outputLimit: 128000, variants: ['low', 'medium', 'high'] },
    { id: 'gpt-5.2', name: 'GPT-5.2', contextLimit: 400000, outputLimit: 128000, variants: ['low', 'medium', 'high', 'xhigh'] },
    { id: 'gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark', contextLimit: 128000, outputLimit: 32000, variants: ['low', 'medium', 'high', 'xhigh'] },
    { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', contextLimit: 400000, outputLimit: 128000, variants: ['low', 'medium', 'high', 'xhigh'] },
    { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex', contextLimit: 400000, outputLimit: 128000, variants: ['low', 'medium', 'high', 'xhigh'] },
    { id: 'codex-mini-latest', name: 'Codex Mini', contextLimit: 200000, outputLimit: 100000, variants: ['low', 'medium', 'high'] },
  ],
  anthropic: [
    { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', contextLimit: 200000, outputLimit: 64000, variants: ['low', 'medium', 'high'] },
    { id: 'anthropic/claude-opus-4.6', name: 'Claude Opus 4.6', contextLimit: 200000, outputLimit: 64000, variants: ['low', 'medium', 'high'] },
  ],
  google: [
    { id: 'google/gemini-3-flash', name: 'Gemini 3 Flash', contextLimit: 1000000, outputLimit: 64000, variants: ['low', 'medium', 'high'] },
    { id: 'google/gemini-3-pro', name: 'Gemini 3 Pro', contextLimit: 1000000, outputLimit: 64000, variants: ['low', 'medium', 'high'] },
  ],
  opencode: [
    { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', contextLimit: 400000, outputLimit: 128000, variants: ['low', 'medium', 'high', 'xhigh'] },
    { id: 'codex-mini-latest', name: 'Codex Mini', contextLimit: 200000, outputLimit: 100000, variants: ['low', 'medium', 'high'] },
  ],
};

export const defaultMcpServers: McpServer[] = [
  {
    id: 'filesystem-mcp',
    name: 'Filesystem MCP',
    capability: 'Local repository navigation and metadata.',
    enabled: true,
    status: 'ready',
  },
  {
    id: 'docs-mcp',
    name: 'Docs MCP',
    capability: 'Remote documentation lookup and citation packaging.',
    enabled: false,
    status: 'idle',
  },
];

export const defaultTranscript: TranscriptEntry[] = [
  {
    id: 'msg-1',
    role: 'system',
    title: 'Workspace booted',
    body: 'Single-session agent workspace ready. Incremental rendering enabled. Tool state is local-first.',
    timestamp: '09:00',
  },
  {
    id: 'msg-2',
    role: 'assistant',
    title: 'Provider context',
    body: 'The harness adapts prompts and routing per model family so Claude- and Codex-style runtimes can coexist.',
    timestamp: '09:01',
  },
  {
    id: 'msg-3',
    role: 'tool',
    title: 'MCP connected',
    body: 'Filesystem MCP mounted with safe local access. Docs MCP remains optional.',
    timestamp: '09:02',
  },
];

export const defaultDebugRequests: DebugRequestEntry[] = [];

export const defaultState: WorkspaceState = {
  workingDirectory: '.',
  selectedProvider: 'anthropic',
  providerConnections: defaultProviderConnections,
  tools: defaultTools,
  mcpServers: defaultMcpServers,
  transcript: defaultTranscript,
  debugRequests: defaultDebugRequests,
};
