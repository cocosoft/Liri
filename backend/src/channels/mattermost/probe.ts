/**
 * Mattermost 通道探针类型
 */

export interface MattermostProbe {
  connected: boolean;
  botUserId?: string;
  botUsername?: string;
  serverUrl: string;
  homeChannel?: string;
  teamId?: string;
  lastPingAt?: number;
}
