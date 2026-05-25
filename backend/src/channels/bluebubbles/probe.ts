/**
 * BlueBubbles 通道探针类型
 */

export interface BlueBubblesProbe {
  connected: boolean;
  serverUrl: string;
  passwordConfigured: boolean;
  homeHandle?: string;
  lastPollAt?: number;
  deviceName?: string;
}
