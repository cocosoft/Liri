import type { RemoteSetting, RemoteSettingsPayload } from './types';
import { RemoteSettingsClient } from './RemoteSettingsClient';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('services:settingsPoller');

export class SettingsPoller {
  private client: RemoteSettingsClient;
  private listeners: Set<() => void | Promise<void>> = new Set();
  private lastPayload: RemoteSettingsPayload | null = null;

  constructor(client: RemoteSettingsClient) {
    this.client = client;
  }

  onChange(listener: () => void | Promise<void>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        void Promise.resolve(listener()).catch((e) => {
          void handleError(e, {
            module: 'services:settings:poller',
            action: '通知监听器失败',
          });
        });
      } catch (e) {
        void handleError(e, {
          module: 'services:settings:poller',
          action: '通知监听器失败',
        });
      }
    }
  }

  async start(): Promise<void> {
    const payload = await this.client.fetchSettings();
    if (payload && payload.version !== this.lastPayload?.version) {
      this.lastPayload = payload;
      this.notifyListeners();
    }
  }

  stop(): void {
    this.client.destroy();
  }

  getLastPayload(): RemoteSettingsPayload | null {
    return this.lastPayload;
  }
}

export class SettingsApplier {
  private client: RemoteSettingsClient;

  constructor(client: RemoteSettingsClient) {
    this.client = client;
  }

  applyToConfig<T extends Record<string, unknown>>(
    config: T,
    mappings: Record<string, keyof T>
  ): T {
    const result = { ...config };

    for (const [settingKey, configKey] of Object.entries(mappings)) {
      const value = this.client.getSetting(settingKey);
      if (value !== undefined) {
        result[configKey] = value as T[keyof T];
      }
    }

    return result;
  }

  applyOverride<T>(key: string, currentValue: T): T {
    const remoteValue = this.client.getSetting<T>(key);
    if (remoteValue === undefined) return currentValue;

    const setting = this.client.getAllSettings().get(key);
    if (setting && !setting.overridable) {
      return remoteValue;
    }

    return remoteValue;
  }

  getRequiredSettings(): RemoteSetting[] {
    const required: RemoteSetting[] = [];
    for (const setting of this.client.getAllSettings().values()) {
      if (setting.required) {
        required.push(setting);
      }
    }
    return required;
  }

  hasAllRequired(): boolean {
    const required = this.getRequiredSettings();
    return required.every((s) => this.client.hasSetting(s.key));
  }
}
