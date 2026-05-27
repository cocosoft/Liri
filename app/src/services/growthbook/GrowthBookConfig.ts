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
  apiHost: process.env.GROWTHBOOK_API_HOST || 'https://cdn.growthbook.io',
  clientKey: process.env.GROWTHBOOK_CLIENT_KEY || '',
  enabled: process.env.GROWTHBOOK_ENABLED !== 'false',
  remoteEval: true,
  timeout: 5000,
  refreshInterval: 60_000,
  enableDebugLogging: process.env.DEBUG_GROWTHBOOK === 'true',
};

export function getApiBaseUrlHost(): string | undefined {
  const baseUrl = process.env.API_BASE_URL;
  if (!baseUrl) return undefined;
  try {
    const host = new URL(baseUrl).host;
    return host || undefined;
  } catch {
    return undefined;
  }
}
