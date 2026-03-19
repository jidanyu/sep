export type ProviderId = 'anthropic' | 'openai' | 'google' | 'opencode';
export type ModelVariant = 'low' | 'medium' | 'high' | 'xhigh';
export type TransportKind = 'browser' | 'tauri';
export type DebugRequestStatus = 'pending' | 'done' | 'error';

export type ToolCategory = 'coding' | 'search' | 'filesystem' | 'network';

export interface ProviderProfile {
  id: ProviderId;
  name: string;
  tone: string;
  strength: string;
  latency: string;
  activeModel: string;
}

export interface ProviderConnection {
  providerId: ProviderId;
  enabled: boolean;
  connected: boolean;
  endpoint: string;
  apiKey: string;
  selectedModel: string;
  selectedVariant: ModelVariant;
  store: boolean;
}

export interface ProviderModelPreset {
  id: string;
  name: string;
  contextLimit: number;
  outputLimit: number;
  variants: ModelVariant[];
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

export interface TranscriptEntry {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  title: string;
  body: string;
  detail?: string;
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
  rawResponseText?: string;
}

export interface WorkspaceState {
  workingDirectory: string;
  selectedProvider: ProviderId;
  providerConnections: ProviderConnection[];
  tools: ToolDefinition[];
  mcpServers: McpServer[];
  transcript: TranscriptEntry[];
  debugRequests: DebugRequestEntry[];
}
