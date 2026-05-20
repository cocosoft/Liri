import { AnthropicProvider } from './AnthropicProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { GoogleProvider } from './GoogleProvider';
import { OllamaProvider } from './OllamaProvider';
import { VertexAIProvider } from './VertexAIProvider';
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
