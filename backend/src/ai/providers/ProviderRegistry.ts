import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import type { AIProvider } from './AIProvider';

const logger = new Logger({ level: LogLevel.INFO });

export class ProviderRegistry {
  private providers: Map<string, AIProvider> = new Map();
  private defaultProviderId: string | null = null;

  register(provider: AIProvider): void {
    if (this.providers.has(provider.id)) {
      logger.warning(
        `Provider already registered, overwriting: ${provider.id}`
      );
    }
    this.providers.set(provider.id, provider);
    logger.info(
      `Provider registered: ${provider.id} (${provider.displayName})`
    );
    if (!this.defaultProviderId) {
      this.defaultProviderId = provider.id;
    }
  }

  unregister(providerId: string): boolean {
    const removed = this.providers.delete(providerId);
    if (removed) {
      logger.info(`Provider unregistered: ${providerId}`);
      if (this.defaultProviderId === providerId) {
        this.defaultProviderId =
          this.providers.size > 0
            ? (this.providers.keys().next().value ?? null)
            : null;
      }
    }
    return removed;
  }

  get(providerId: string): AIProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new AppError(
        `Provider not found: ${providerId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    return provider;
  }

  has(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  list(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  listIds(): string[] {
    return Array.from(this.providers.keys());
  }

  getDefaultProvider(): AIProvider {
    if (!this.defaultProviderId) {
      throw new AppError(
        'No providers registered',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    return this.get(this.defaultProviderId);
  }

  setDefaultProvider(providerId: string): void {
    if (!this.providers.has(providerId)) {
      throw new AppError(
        `Cannot set default: provider not found: ${providerId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    this.defaultProviderId = providerId;
    logger.info(`Default provider set to: ${providerId}`);
  }

  getDefaultProviderId(): string | null {
    return this.defaultProviderId;
  }

  clear(): void {
    this.providers.clear();
    this.defaultProviderId = null;
    logger.info('All providers cleared');
  }

  get size(): number {
    return this.providers.size;
  }
}

export const providerRegistry = new ProviderRegistry();
