export type ProviderId = 'anthropic' | 'openai' | 'google' | 'opencode';
export type ModelVariant = 'low' | 'medium' | 'high' | 'xhigh';

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
  timestamp: string;
}

export interface WorkspaceState {
  selectedProvider: ProviderId;
  providerConnections: ProviderConnection[];
  tools: ToolDefinition[];
  mcpServers: McpServer[];
  transcript: TranscriptEntry[];
}
