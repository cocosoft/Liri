//
/**
 * REPL桥接（基于CC源码 bridge/replBridge.ts）
 */
import { Stream } from '../streaming/Stream';

export interface ReplBridgeConfig {
  enabled: boolean;
  sessionId: string;
  deviceId?: string;
}

export class ReplBridge {
  private config: ReplBridgeConfig;

  constructor(config: ReplBridgeConfig) {
    this.config = config;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getSessionId(): string {
    return this.config.sessionId;
  }

  async connectRemote(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.config.sessionId,
          deviceId: this.config.deviceId,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  createBridgeStream<T>(): Stream<T> {
    return new Stream<T>();
  }
}
