export interface RemoteSetting {
  key: string
  value: unknown
  category: 'model' | 'security' | 'ui' | 'tools' | 'general'
  required: boolean
  overridable: boolean
  description?: string
}

export interface RemoteSettingsPayload {
  settings: RemoteSetting[]
  version: number
  timestamp: number
}

export interface RemoteSettingsClientConfig {
  apiUrl: string
  apiKey?: string
  pollInterval: number
  timeout: number
  cacheTTL: number
  enabled: boolean
}

export const DEFAULT_REMOTE_SETTINGS_CONFIG: RemoteSettingsClientConfig = {
  apiUrl: process.env.REMOTE_SETTINGS_API_URL || '',
  apiKey: process.env.REMOTE_SETTINGS_API_KEY,
  pollInterval: parseInt(process.env.REMOTE_SETTINGS_POLL_INTERVAL || '300000', 10),
  timeout: 10000,
  cacheTTL: 600_000,
  enabled: process.env.REMOTE_SETTINGS_ENABLED === 'true' || !!process.env.REMOTE_SETTINGS_API_URL,
}
