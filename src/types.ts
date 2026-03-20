export type BuiltinProviderId = 'anthropic' | 'openai' | 'google' | 'opencode';
export type ProviderId = string;
export type ModelVariant = 'low' | 'medium' | 'high' | 'xhigh';
export type TransportKind = 'browser' | 'tauri';
export type DebugRequestStatus = 'pending' | 'done' | 'error';

export type ToolCategory = 'coding' | 'search' | 'filesystem' | 'network';

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedTokens?: number;
  cacheCreationTokens?: number;
}

export interface ProviderProfile {
  id: ProviderId;
  name: string;
  tone: string;
  strength: string;
  latency: string;
  activeModel: string;
}

export interface ProviderModelPreset {
  id: string;
  name: string;
  contextLimit: number;
  outputLimit: number;
  variants: ModelVariant[];
}

export interface ProviderConnection {
  providerId: ProviderId;
  adapterKind?: BuiltinProviderId;
  displayName?: string;
  customModels?: ProviderModelPreset[];
  enabled: boolean;
  connected: boolean;
  endpoint: string;
  apiKey: string;
  selectedModel: string;
  selectedVariant: ModelVariant;
  store: boolean;
}

export interface ToolDefinition {
  id: string;
  name: string;
  category: ToolCategory;
  description: string;
  enabled: boolean;
}

export interface McpServer {
  id: string;
  name: string;
  capability: string;
  enabled: boolean;
  status: 'ready' | 'idle';
}

export interface PlanStep {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface TranscriptEntry {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  title: string;
  body: string;
  detail?: string;
  planSteps?: PlanStep[];
  timestamp: string;
}

export interface DebugRequestEntry {
  id: string;
  requestId: string;
  providerId: ProviderId;
  model: string;
  variant?: ModelVariant;
  transport: TransportKind;
  endpoint: string;
  startedAt: string;
  startedAtUnixMs: number;
  status: DebugRequestStatus;
  historyMessageCount: number;
  payloadMessageCount: number;
  inputChars: number;
  outputChars: number;
  durationMs?: number;
  error?: string;
  requestJson: string;
  responseText?: string;
  traceText?: string;
  rawResponseText?: string;
  usage?: TokenUsage;
}

export interface Session {
  id: string;
  name: string;
  workingDirectory: string;
  selectedProvider: ProviderId;
  transcript: TranscriptEntry[];
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceState {
  workingDirectory: string;
  selectedProvider: ProviderId;
  providerConnections: ProviderConnection[];
  tools: ToolDefinition[];
  mcpServers: McpServer[];
  transcript: TranscriptEntry[];
  debugRequests: DebugRequestEntry[];
  sessions: Session[];
  currentSessionId: string;
}
