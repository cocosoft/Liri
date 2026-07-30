import type {
  RemoteSetting,
  RemoteSettingsPayload,
  RemoteSettingsClientConfig,
} from './types';
import { DEFAULT_REMOTE_SETTINGS_CONFIG } from './types';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({
  module: 'services:remoteSettingsClient',
  level: LogLevel.INFO,
});

export class RemoteSettingsClient {
  private config: RemoteSettingsClientConfig;
  private cachedSettings: Map<string, RemoteSetting> = new Map();
  private lastFetchTime: number = 0;
  private lastVersion: number = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private initialized: boolean = false;

  constructor(config?: Partial<RemoteSettingsClientConfig>) {
    this.config = { ...DEFAULT_REMOTE_SETTINGS_CONFIG, ...config };
  }

  get isEnabled(): boolean {
    return this.config.enabled && !!this.config.apiUrl;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  async initialize(): Promise<void> {
    if (!this.isEnabled) {
      this.initialized = true;
      return;
    }

    await this.fetchSettings();

    if (this.config.pollInterval > 0) {
      this.startPolling();
    }

    this.initialized = true;
  }

  async fetchSettings(): Promise<RemoteSettingsPayload | null> {
    if (!this.isEnabled) return null;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.timeout
      );

      const response = await fetch(this.config.apiUrl, {
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey && { 'X-API-Key': this.config.apiKey }),
          'If-None-Match': this.lastVersion ? String(this.lastVersion) : '',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 304) {
        this.lastFetchTime = Date.now();
        return null;
      }

      if (!response.ok) {
        logger.warning(
          `[RemoteSettings] HTTP ${response.status}: ${response.statusText}`
        );
        return null;
      }

      const payload = (await response.json()) as RemoteSettingsPayload;

      if (!payload.settings || !Array.isArray(payload.settings)) {
        logger.warning('[RemoteSettings] Invalid payload format');
        return null;
      }

      this.applySettings(payload.settings);
      this.lastFetchTime = Date.now();
      this.lastVersion = payload.version;

      return payload;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        logger.warning('[RemoteSettings] Request timeout');
      } else {
        void handleError(error, {
          module: 'services:settings:client',
          action: '获取远程设置失败',
        });
      }
      return null;
    }
  }

  private applySettings(settings: RemoteSetting[]): void {
    for (const setting of settings) {
      this.cachedSettings.set(setting.key, setting);
    }
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      // @ignore-catch — 定期拉取设置fire-and-forget，失败使用缓存
      this.fetchSettings().catch(() => {});
    }, this.config.pollInterval);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  getSetting<T>(key: string): T | undefined {
    const setting = this.cachedSettings.get(key);
    if (!setting) return undefined;
    return setting.value as T;
  }

  getSettingWithDefault<T>(key: string, defaultValue: T): T {
    const value = this.getSetting<T>(key);
    return value !== undefined ? value : defaultValue;
  }

  getAllSettings(): ReadonlyMap<string, RemoteSetting> {
    return this.cachedSettings;
  }

  getSettingsByCategory(category: RemoteSetting['category']): RemoteSetting[] {
    const result: RemoteSetting[] = [];
    for (const setting of this.cachedSettings.values()) {
      if (setting.category === category) {
        result.push(setting);
      }
    }
    return result;
  }

  hasSetting(key: string): boolean {
    return this.cachedSettings.has(key);
  }

  isCacheValid(): boolean {
    return Date.now() - this.lastFetchTime < this.config.cacheTTL;
  }

  getLastFetchTime(): number {
    return this.lastFetchTime;
  }

  destroy(): void {
    this.stopPolling();
    this.cachedSettings.clear();
    this.initialized = false;
  }
}

export function getRemoteSettingsClient(
  config?: Partial<RemoteSettingsClientConfig>
): RemoteSettingsClient {
  return new RemoteSettingsClient(config);
}
