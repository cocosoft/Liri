import { AnthropicProvider } from './AnthropicProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { GoogleProvider } from './GoogleProvider';
import { OllamaProvider } from './OllamaProvider';
import { VertexAIProvider } from './VertexAIProvider';
import { DeepSeekProvider } from './DeepSeekProvider';
import { BedrockProvider } from './BedrockProvider';
import { AzureOpenAIProvider } from './AzureOpenAIProvider';
import { MoonshotProvider } from './MoonshotProvider';
import { GrokProvider } from './GrokProvider';
import { providerRegistry } from './ProviderRegistry';
import type { ProviderConfig } from './AIProvider';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

export function registerDefaultProviders(config?: {
  anthropic?: Partial<ProviderConfig>;
  openai?: Partial<ProviderConfig>;
  google?: Partial<ProviderConfig>;
  ollama?: Partial<ProviderConfig>;
  vertexAi?: Partial<ProviderConfig>;
  deepseek?: Partial<ProviderConfig>;
  bedrock?: Partial<ProviderConfig>;
  azureOpenAi?: Partial<ProviderConfig>;
  moonshot?: Partial<ProviderConfig>;
  grok?: Partial<ProviderConfig>;
}): void {
  const existingProviders = providerRegistry.listIds();
  if (existingProviders.length > 0) {
    logger.info('Providers already registered, skipping registration');
    return;
  }

  logger.info('Registering default AI providers...');

  providerRegistry.register(new AnthropicProvider(config?.anthropic ?? {}));
  providerRegistry.register(new OpenAIProvider(config?.openai ?? {}));
  providerRegistry.register(new GoogleProvider(config?.google ?? {}));
  providerRegistry.register(new OllamaProvider(config?.ollama ?? {}));
  providerRegistry.register(new VertexAIProvider(config?.vertexAi ?? {}));
  providerRegistry.register(new DeepSeekProvider(config?.deepseek ?? {}));
  providerRegistry.register(new BedrockProvider(config?.bedrock ?? {}));
  providerRegistry.register(new AzureOpenAIProvider(config?.azureOpenAi ?? {}));
  providerRegistry.register(new MoonshotProvider(config?.moonshot ?? {}));
  providerRegistry.register(new GrokProvider(config?.grok ?? {}));

  logger.info(
    `Registered ${providerRegistry.size} AI providers: ${providerRegistry.listIds().join(', ')}`
  );
}

export function registerAnthropicProvider(config?: ProviderConfig): void {
  if (!providerRegistry.has('anthropic')) {
    providerRegistry.register(new AnthropicProvider(config ?? {}));
    logger.info('Anthropic provider registered');
  }
}

export function registerOpenAIProvider(config?: ProviderConfig): void {
  if (!providerRegistry.has('openai')) {
    providerRegistry.register(new OpenAIProvider(config ?? {}));
    logger.info('OpenAI provider registered');
  }
}

export function registerGoogleProvider(config?: ProviderConfig): void {
  if (!providerRegistry.has('google')) {
    providerRegistry.register(new GoogleProvider(config ?? {}));
    logger.info('Google provider registered');
  }
}

export function registerOllamaProvider(config?: ProviderConfig): void {
  if (!providerRegistry.has('ollama')) {
    providerRegistry.register(new OllamaProvider(config ?? {}));
    logger.info('Ollama provider registered');
  }
}

export function registerVertexAIProvider(config?: ProviderConfig): void {
  if (!providerRegistry.has('vertex-ai')) {
    providerRegistry.register(new VertexAIProvider(config ?? {}));
    logger.info('Vertex AI provider registered');
  }
}

export function registerDeepSeekProvider(config?: ProviderConfig): void {
  if (!providerRegistry.has('deepseek')) {
    providerRegistry.register(new DeepSeekProvider(config ?? {}));
    logger.info('DeepSeek provider registered');
  }
}

export function registerBedrockProvider(config?: ProviderConfig): void {
  if (!providerRegistry.has('bedrock')) {
    providerRegistry.register(new BedrockProvider(config ?? {}));
    logger.info('Bedrock provider registered');
  }
}

export function registerAzureOpenAIProvider(config?: ProviderConfig): void {
  if (!providerRegistry.has('azure-openai')) {
    providerRegistry.register(new AzureOpenAIProvider(config ?? {}));
    logger.info('Azure OpenAI provider registered');
  }
}

export function registerMoonshotProvider(config?: ProviderConfig): void {
  if (!providerRegistry.has('moonshot')) {
    providerRegistry.register(new MoonshotProvider(config ?? {}));
    logger.info('Moonshot provider registered');
  }
}

export function registerGrokProvider(config?: ProviderConfig): void {
  if (!providerRegistry.has('grok')) {
    providerRegistry.register(new GrokProvider(config ?? {}));
    logger.info('Grok provider registered');
  }
}
