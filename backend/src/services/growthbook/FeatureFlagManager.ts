import { GrowthBookClient, getGrowthBookClient } from './GrowthBookClient'
import type { GrowthBookUserAttributes } from './GrowthBookConfig'

export interface FeatureFlagEntry {
  key: string
  defaultValue: boolean | string | number | object
  description?: string
  category?: string
}

export class FeatureFlagManager {
  private static instance: FeatureFlagManager | null = null
  private client: GrowthBookClient
  private localOverrides: Map<string, unknown> = new Map()
  private memoryCache: Map<string, { value: unknown; timestamp: number }> = new Map()
  private cacheTTL: number = 30_000
  private localFlags: Map<string, FeatureFlagEntry> = new Map()

  private constructor() {
    this.client = getGrowthBookClient()
  }

  static getInstance(): FeatureFlagManager {
    if (!FeatureFlagManager.instance) {
      FeatureFlagManager.instance = new FeatureFlagManager()
    }
    return FeatureFlagManager.instance
  }

  static resetInstance(): void {
    FeatureFlagManager.instance = null
  }

  registerLocalFlag(entry: FeatureFlagEntry): void {
    this.localFlags.set(entry.key, entry)
  }

  registerLocalFlags(entries: FeatureFlagEntry[]): void {
    for (const entry of entries) {
      this.registerLocalFlag(entry)
    }
  }

  getRegisteredFlags(): ReadonlyMap<string, FeatureFlagEntry> {
    return this.localFlags
  }

  setLocalOverride(feature: string, value: unknown): void {
    this.localOverrides.set(feature, value)
    this.memoryCache.delete(feature)
  }

  removeLocalOverride(feature: string): void {
    this.localOverrides.delete(feature)
    this.memoryCache.delete(feature)
  }

  clearLocalOverrides(): void {
    this.localOverrides.clear()
    this.memoryCache.clear()
  }

  getLocalOverrides(): ReadonlyMap<string, unknown> {
    return this.localOverrides
  }

  async initialize(attributes: GrowthBookUserAttributes): Promise<void> {
    await this.client.initialize(attributes)
  }

  getFlag<T>(feature: string, defaultValue: T): T {
    if (this.localOverrides.has(feature)) {
      return this.localOverrides.get(feature) as T
    }

    const cached = this.memoryCache.get(feature)
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.value as T
    }

    const value = this.client.getFeatureValue<T>(feature, defaultValue)
    this.memoryCache.set(feature, { value, timestamp: Date.now() })

    if (value !== defaultValue) {
      this.client.logExposure(feature)
    }

    return value
  }

  getFlagCached<T>(feature: string, defaultValue: T): T {
    if (this.localOverrides.has(feature)) {
      return this.localOverrides.get(feature) as T
    }

    return this.client.getFeatureValueCached<T>(feature, defaultValue)
  }

  getAllFlags(): Record<string, unknown> {
    const remote = this.client.getAllFeatures()
    const result: Record<string, unknown> = { ...remote }

    for (const [key, entry] of this.localFlags) {
      if (!(key in result)) {
        result[key] = entry.defaultValue
      }
    }

    for (const [key, value] of this.localOverrides) {
      result[key] = value
    }

    return result
  }

  onRefresh(listener: () => void | Promise<void>): () => void {
    return this.client.onRefresh(listener)
  }

  async refreshFeatures(): Promise<void> {
    await this.client.refreshFeatures()
    this.memoryCache.clear()
  }

  isEnabled(): boolean {
    return this.client.isEnabled()
  }

  isInitialized(): boolean {
    return this.client.isInitialized()
  }

  setCacheTTL(ttl: number): void {
    this.cacheTTL = ttl
  }
}

export function getFeatureFlagManager(): FeatureFlagManager {
  return FeatureFlagManager.getInstance()
}

export function getFlag<T>(feature: string, defaultValue: T): T {
  return getFeatureFlagManager().getFlag(feature, defaultValue)
}

export function getFlagCached<T>(feature: string, defaultValue: T): T {
  return getFeatureFlagManager().getFlagCached(feature, defaultValue)
}
