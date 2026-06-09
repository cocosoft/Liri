import { configManager } from '@modules/config';

export interface GrowthBookUserAttributes {
  id: string;
  sessionId: string;
  deviceId: string;
  platform: 'win32' | 'darwin' | 'linux';
  appVersion?: string;
  userType?: string;
  organizationId?: string;
  accountId?: string;
  email?: string;
  subscriptionType?: string;
  rateLimitTier?: string;
  firstTokenTime?: number;
  apiBaseUrlHost?: string;
}

export interface GrowthBookConfig {
  apiHost: string;
  clientKey: string;
  enabled: boolean;
  remoteEval: boolean;
  timeout: number;
  refreshInterval: number;
  enableDebugLogging: boolean;
}

export const DEFAULT_GROWTHBOOK_CONFIG: GrowthBookConfig = {
  apiHost: configManager.env('GROWTHBOOK_API_HOST') || 'https://cdn.growthbook.io',
  clientKey: configManager.env('GROWTHBOOK_CLIENT_KEY') || '',
  enabled: configManager.env('GROWTHBOOK_ENABLED') !== 'false',
  remoteEval: true,
  timeout: 5000,
  refreshInterval: 60_000,
  enableDebugLogging: configManager.env('DEBUG_GROWTHBOOK') === 'true',
};

export function getApiBaseUrlHost(): string | undefined {
  const baseUrl = configManager.env('API_BASE_URL');
  if (!baseUrl) return undefined;
  try {
    const host = new URL(baseUrl).host;
    return host || undefined;
  } catch {
    return undefined;
  }
}
