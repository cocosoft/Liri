import type {
  FlowContribution,
  FlowOption,
  FlowContext,
  FlowConfigProvider,
  ProviderSetupResult,
} from './types.js';
import { sortFlowContributionsByLabel } from './types.js';

export type ProviderFlowScope = 'text-inference' | 'image-generation';

export type ProviderSetupFlowOption = FlowOption & {
  onboardingScopes?: ProviderFlowScope[];
};

export type ProviderSetupFlowContribution = FlowContribution & {
  kind: 'provider';
  surface: 'setup';
  providerId: string;
  pluginId?: string;
  option: ProviderSetupFlowOption;
  onboardingScopes?: ProviderFlowScope[];
  source: 'manifest' | 'install-catalog';
};

export type ProviderAuthConfig = {
  apiKey?: string;
  baseUrl?: string;
  organizationId?: string;
  projectId?: string;
};

const providerRegistry = new Map<string, ProviderSetupFlowContribution>();

const DEFAULT_PROVIDERS: ProviderSetupFlowContribution[] = [
  {
    id: 'provider:setup:openai',
    kind: 'provider',
    surface: 'setup',
    providerId: 'openai',
    pluginId: 'openai',
    option: {
      value: 'openai',
      label: 'OpenAI',
      hint: 'GPT-4, GPT-4o, GPT-4o-mini',
      group: { id: 'openai', label: 'OpenAI' },
    },
    onboardingScopes: ['text-inference', 'image-generation'],
    source: 'manifest',
  },
  {
    id: 'provider:setup:anthropic',
    kind: 'provider',
    surface: 'setup',
    providerId: 'anthropic',
    pluginId: 'anthropic',
    option: {
      value: 'anthropic',
      label: 'Anthropic',
      hint: 'Claude Sonnet 4, Claude Haiku 3.5',
      group: { id: 'anthropic', label: 'Anthropic' },
    },
    onboardingScopes: ['text-inference'],
    source: 'manifest',
  },
  {
    id: 'provider:setup:google',
    kind: 'provider',
    surface: 'setup',
    providerId: 'google',
    pluginId: 'google-ai',
    option: {
      value: 'google',
      label: 'Google AI',
      hint: 'Gemini 1.5/2.0',
      group: { id: 'google', label: 'Google AI' },
    },
    onboardingScopes: ['text-inference', 'image-generation'],
    source: 'manifest',
  },
  {
    id: 'provider:setup:deepseek',
    kind: 'provider',
    surface: 'setup',
    providerId: 'deepseek',
    pluginId: 'deepseek',
    option: {
      value: 'deepseek',
      label: 'DeepSeek',
      hint: 'DeepSeek Chat, DeepSeek Reasoner',
      group: { id: 'deepseek', label: 'DeepSeek' },
    },
    onboardingScopes: ['text-inference'],
    source: 'manifest',
  },
  {
    id: 'provider:setup:mistral',
    kind: 'provider',
    surface: 'setup',
    providerId: 'mistral',
    pluginId: 'mistral',
    option: {
      value: 'mistral',
      label: 'Mistral AI',
      hint: 'Mistral Large, Mistral Small',
      group: { id: 'mistral', label: 'Mistral AI' },
    },
    onboardingScopes: ['text-inference'],
    source: 'manifest',
  },
  {
    id: 'provider:setup:groq',
    kind: 'provider',
    surface: 'setup',
    providerId: 'groq',
    pluginId: 'groq',
    option: {
      value: 'groq',
      label: 'Groq',
      hint: 'Llama, Mixtral (fast inference)',
      group: { id: 'groq', label: 'Groq' },
    },
    onboardingScopes: ['text-inference'],
    source: 'manifest',
  },
  {
    id: 'provider:setup:cohere',
    kind: 'provider',
    surface: 'setup',
    providerId: 'cohere',
    pluginId: 'cohere',
    option: {
      value: 'cohere',
      label: 'Cohere',
      hint: 'Command R+, Command R',
      group: { id: 'cohere', label: 'Cohere' },
    },
    onboardingScopes: ['text-inference'],
    source: 'manifest',
  },
  {
    id: 'provider:setup:openrouter',
    kind: 'provider',
    surface: 'setup',
    providerId: 'openrouter',
    pluginId: 'openrouter',
    option: {
      value: 'openrouter',
      label: 'OpenRouter',
      hint: 'Multi-provider router',
      group: { id: 'openrouter', label: 'OpenRouter' },
    },
    onboardingScopes: ['text-inference', 'image-generation'],
    source: 'manifest',
  },
  {
    id: 'provider:setup:together',
    kind: 'provider',
    surface: 'setup',
    providerId: 'together',
    pluginId: 'together',
    option: {
      value: 'together',
      label: 'Together AI',
      hint: 'Open-source model hosting',
      group: { id: 'together', label: 'Together AI' },
    },
    onboardingScopes: ['text-inference'],
    source: 'manifest',
  },
];

for (const provider of DEFAULT_PROVIDERS) {
  providerRegistry.set(provider.id, provider);
}

/**
 * 注册提供商设置流程贡献。
 */
export function registerProviderFlowContribution(
  contribution: ProviderSetupFlowContribution
): void {
  providerRegistry.set(contribution.id, contribution);
}

/**
 * 获取提供商设置流程贡献列表。
 */
export function getProviderSetupFlow(
  providerId: string
): ProviderSetupFlowContribution | undefined {
  for (const entry of providerRegistry.values()) {
    if (entry.providerId === providerId) {
      return entry;
    }
  }
  return undefined;
}

/**
 * 获取提供商设置流程贡献列表，按标签排序。
 */
export function getProviderSetupFlowContributions(options?: {
  scope?: ProviderFlowScope;
}): ProviderSetupFlowContribution[] {
  let entries = Array.from(providerRegistry.values());

  if (options?.scope) {
    entries = entries.filter(
      (e) => !e.onboardingScopes || e.onboardingScopes.includes(options.scope!)
    );
  }

  return sortFlowContributionsByLabel(entries);
}

/**
 * 列出所有已注册的提供商 ID。
 */
export function listRegisteredProviderIds(): string[] {
  const ids = new Set<string>();
  for (const entry of providerRegistry.values()) {
    ids.add(entry.providerId);
  }
  return Array.from(ids).sort();
}

/**
 * 解析提供商认证配置。
 */
export function resolveProviderAuthConfig(
  providerId: string,
  context: FlowContext
): ProviderAuthConfig {
  const envKeyMap: Record<string, string[]> = {
    openai: ['OPENAI_API_KEY'],
    anthropic: ['ANTHROPIC_API_KEY'],
    google: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
    deepseek: ['DEEPSEEK_API_KEY'],
    mistral: ['MISTRAL_API_KEY'],
    groq: ['GROQ_API_KEY'],
    cohere: ['COHERE_API_KEY'],
    openrouter: ['OPENROUTER_API_KEY'],
    together: ['TOGETHER_API_KEY'],
  };

  const keys = envKeyMap[providerId] ?? [];
  const apiKey = keys.reduce<string | undefined>((found, key) => {
    return found ?? context.env?.[key];
  }, undefined);

  return { apiKey };
}

/**
 * 执行提供商设置流程。
 */
export async function setupProvider(
  providerId: string,
  context: FlowContext = {},
  configProvider: FlowConfigProvider
): Promise<ProviderSetupResult> {
  const flow = getProviderSetupFlow(providerId);

  if (!flow) {
    return {
      providerId,
      configured: false,
      error: `Unknown provider: ${providerId}`,
    };
  }

  const authConfig = resolveProviderAuthConfig(providerId, context);

  if (!authConfig.apiKey) {
    return {
      providerId,
      configured: false,
      error: `No API key found for provider: ${providerId}`,
    };
  }

  configProvider.set(`providers.${providerId}.apiKey`, authConfig.apiKey);
  if (authConfig.baseUrl) {
    configProvider.set(`providers.${providerId}.baseUrl`, authConfig.baseUrl);
  }

  return { providerId, configured: true, pluginId: flow.pluginId };
}
