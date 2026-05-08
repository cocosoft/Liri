//
import { GrowthBook } from '@growthbook/growthbook'
import type { GrowthBookUserAttributes, GrowthBookConfig } from './GrowthBookConfig'
import { DEFAULT_GROWTHBOOK_CONFIG } from './GrowthBookConfig'

export type FeatureRefreshListener = () => void | Promise<void>

export class GrowthBookClient {
  private static instance: GrowthBookClient | null = null
  private client: GrowthBook | null = null
  private config: GrowthBookConfig
  private initialized: boolean = false
  private initPromise: Promise<void> | null = null
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private refreshListeners: Set<FeatureRefreshListener> = new Set()
  private remoteEvalCache: Map<string, unknown> = new Map()
  private exposureLogged: Set<string> = new Set()

  private constructor(config?: Partial<GrowthBookConfig>) {
    this.config = { ...DEFAULT_GROWTHBOOK_CONFIG, ...config }
  }

  static getInstance(config?: Partial<GrowthBookConfig>): GrowthBookClient {
    if (!GrowthBookClient.instance) {
      GrowthBookClient.instance = new GrowthBookClient(config)
    }
    return GrowthBookClient.instance
  }

  static resetInstance(): void {
    if (GrowthBookClient.instance) {
      GrowthBookClient.instance.destroy()
      GrowthBookClient.instance = null
    }
  }

  getConfig(): GrowthBookConfig {
    return { ...this.config }
  }

  isEnabled(): boolean {
    return this.config.enabled && !!this.config.clientKey
  }

  isInitialized(): boolean {
    return this.initialized
  }

  async initialize(attributes: GrowthBookUserAttributes): Promise<void> {
    if (!this.isEnabled()) {
      return
    }

    if (this.initPromise) {
      return this.initPromise
    }

    this.initPromise = this.doInitialize(attributes)
    return this.initPromise
  }

  private async doInitialize(attributes: GrowthBookUserAttributes): Promise<void> {
    try {
      this.client = new GrowthBook({
        apiHost: this.config.apiHost,
        clientKey: this.config.clientKey,
        attributes: {
          id: attributes.id,
          sessionId: attributes.sessionId,
          deviceID: attributes.deviceId,
          platform: attributes.platform,
          ...(attributes.appVersion && { appVersion: attributes.appVersion }),
          ...(attributes.userType && { userType: attributes.userType }),
          ...(attributes.organizationId && { organizationUUID: attributes.organizationId }),
          ...(attributes.accountId && { accountUUID: attributes.accountId }),
          ...(attributes.email && { email: attributes.email }),
          ...(attributes.subscriptionType && { subscriptionType: attributes.subscriptionType }),
          ...(attributes.rateLimitTier && { rateLimitTier: attributes.rateLimitTier }),
          ...(attributes.firstTokenTime && { firstTokenTime: attributes.firstTokenTime }),
          ...(attributes.apiBaseUrlHost && { apiBaseUrlHost: attributes.apiBaseUrlHost }),
        },
        remoteEval: this.config.remoteEval,
        cacheKeyAttributes: ['id', 'organizationUUID'],
        ...(this.config.enableDebugLogging && {
          log: (msg: string, ctx: Record<string, unknown>) => {
            console.debug(`[GrowthBook] ${msg}`, ctx)
          },
        }),
      })

      const result = await this.client.init({ timeout: this.config.timeout })

      if (this.config.enableDebugLogging) {
        console.debug(`[GrowthBook] Initialized: source=${result.source}, success=${result.success}`)
      }

      if (result.success) {
        await this.processRemoteEvalPayload()
        this.initialized = true
        this.startPeriodicRefresh()
        this.notifyListeners()
      }
    } catch (error) {
      console.error('[GrowthBook] Initialization failed:', error)
      this.initPromise = null
    }
  }

  private async processRemoteEvalPayload(): Promise<void> {
    if (!this.client) return

    const payload = this.client.getPayload()
    if (!payload?.features || Object.keys(payload.features).length === 0) {
      return
    }

    this.remoteEvalCache.clear()

    const features = payload.features as Record<string, Record<string, unknown>>
    for (const [key, feature] of Object.entries(features)) {
      const value = 'defaultValue' in feature ? feature.defaultValue :
        'value' in feature ? feature.value :
        undefined
      if (value !== undefined) {
        this.remoteEvalCache.set(key, value)
      }
    }
  }

  private startPeriodicRefresh(): void {
    this.stopPeriodicRefresh()

    this.refreshTimer = setInterval(async () => {
      if (!this.client) return
      try {
        await this.client.refreshFeatures()
        await this.processRemoteEvalPayload()
        this.notifyListeners()
      } catch (error) {
        if (this.config.enableDebugLogging) {
          console.debug('[GrowthBook] Refresh failed:', error)
        }
      }
    }, this.config.refreshInterval)
  }

  private stopPeriodicRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  onRefresh(listener: FeatureRefreshListener): () => void {
    this.refreshListeners.add(listener)
    return () => {
      this.refreshListeners.delete(listener)
    }
  }

  private notifyListeners(): void {
    for (const listener of this.refreshListeners) {
      try {
        void Promise.resolve(listener()).catch(e => {
          console.error('[GrowthBook] Listener error:', e)
        })
      } catch (e) {
        console.error('[GrowthBook] Listener error:', e)
      }
    }
  }

  getFeatureValue<T>(feature: string, defaultValue: T): T {
    if (!this.isEnabled()) {
      return defaultValue
    }

    if (this.remoteEvalCache.has(feature)) {
      return this.remoteEvalCache.get(feature) as T
    }

    if (this.client && this.initialized) {
      return this.client.getFeatureValue(feature, defaultValue) as T
    }

    return defaultValue
  }

  getFeatureValueCached<T>(feature: string, defaultValue: T): T {
    if (this.remoteEvalCache.has(feature)) {
      return this.remoteEvalCache.get(feature) as T
    }

    if (this.client && this.initialized) {
      const value = this.client.getFeatureValue(feature, defaultValue) as T
      this.remoteEvalCache.set(feature, value)
      return value
    }

    return defaultValue
  }

  getAllFeatures(): Record<string, unknown> {
    if (!this.remoteEvalCache || this.remoteEvalCache.size === 0) {
      return {}
    }
    return Object.fromEntries(this.remoteEvalCache)
  }

  logExposure(feature: string): void {
    if (this.exposureLogged.has(feature)) return
    this.exposureLogged.add(feature)
    this.client?.logFeatureUse?.(feature)
  }

  async refreshFeatures(): Promise<void> {
    if (!this.client) return
    try {
      await this.client.refreshFeatures()
      await this.processRemoteEvalPayload()
      this.notifyListeners()
    } catch (error) {
      if (this.config.enableDebugLogging) {
        console.debug('[GrowthBook] Manual refresh failed:', error)
      }
    }
  }

  destroy(): void {
    this.stopPeriodicRefresh()
    this.client?.destroy()
    this.client = null
    this.initialized = false
    this.initPromise = null
    this.remoteEvalCache.clear()
    this.exposureLogged.clear()
  }
}

export function getGrowthBookClient(config?: Partial<GrowthBookConfig>): GrowthBookClient {
  return GrowthBookClient.getInstance(config)
}
