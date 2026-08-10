// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * Agent Auth Profiles
 * 对标OpenClaw agents/auth-profiles/
 * 多Provider认证配置管理
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('agent\auth-profiles\index');

export type AuthProviderType =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'azure'
  | 'aws'
  | 'custom';

export interface AuthProfile {
  id: string;
  name: string;
  provider: AuthProviderType;
  apiKey?: string;
  baseUrl?: string;
  organizationId?: string;
  projectId?: string;
  defaultModel?: string;
  config?: Record<string, unknown>;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AuthProfileManagerConfig {
  storagePath?: string;
  encryptionKey?: string;
  maxProfiles?: number;
}

export class AuthProfileManager {
  private profiles: Map<string, AuthProfile> = new Map();
  private activeProfileId: string | null = null;
  private config: Required<AuthProfileManagerConfig>;

  constructor(config?: AuthProfileManagerConfig) {
    this.config = {
      storagePath: config?.storagePath ?? '',
      encryptionKey: config?.encryptionKey ?? '',
      maxProfiles: config?.maxProfiles ?? 20,
    };
  }

  createProfile(
    profile: Omit<AuthProfile, 'id' | 'createdAt' | 'updatedAt' | 'isActive'>
  ): AuthProfile {
    if (this.profiles.size >= this.config.maxProfiles) {
      throw new AppError(
        `Max profiles (${this.config.maxProfiles}) reached`,
        ErrorCategory.RESOURCE,
        ErrorSeverity.HIGH,
        'RESOURCE_EXHAUSTED',
        { current: this.profiles.size, max: this.config.maxProfiles }
      );
    }

    const id = `${profile.provider}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const newProfile: AuthProfile = {
      ...profile,
      id,
      isActive: this.profiles.size === 0,
      createdAt: now,
      updatedAt: now,
    };

    this.profiles.set(id, newProfile);

    if (this.profiles.size === 1) {
      this.activeProfileId = id;
    }

    return newProfile;
  }

  updateProfile(
    id: string,
    updates: Partial<Omit<AuthProfile, 'id' | 'createdAt'>>
  ): boolean {
    const profile = this.profiles.get(id);
    if (!profile) return false;

    Object.assign(profile, updates, { updatedAt: Date.now() });
    return true;
  }

  deleteProfile(id: string): boolean {
    const deleted = this.profiles.delete(id);

    if (this.activeProfileId === id) {
      const firstKey = this.profiles.keys().next().value;
      this.activeProfileId = firstKey ?? null;

      if (firstKey) {
        const profile = this.profiles.get(firstKey);
        if (profile) {
          profile.isActive = true;
        }
      }
    }

    return deleted;
  }

  getProfile(id: string): AuthProfile | undefined {
    return this.profiles.get(id);
  }

  setActiveProfile(id: string): boolean {
    const profile = this.profiles.get(id);
    if (!profile) return false;

    const currentActive = this.getActiveProfile();
    if (currentActive) {
      currentActive.isActive = false;
    }

    profile.isActive = true;
    this.activeProfileId = id;

    return true;
  }

  getActiveProfile(): AuthProfile | undefined {
    if (!this.activeProfileId) return undefined;
    return this.profiles.get(this.activeProfileId);
  }

  listProfiles(filter?: { provider?: AuthProviderType }): AuthProfile[] {
    let result = Array.from(this.profiles.values());

    if (filter?.provider) {
      result = result.filter((p) => p.provider === filter.provider);
    }

    result.sort((a, b) => b.updatedAt - a.updatedAt);
    return result;
  }

  getProviders(): AuthProviderType[] {
    return Array.from(
      new Set(Array.from(this.profiles.values()).map((p) => p.provider))
    ).sort();
  }

  getProviderProfiles(provider: AuthProviderType): AuthProfile[] {
    return this.listProfiles({ provider });
  }

  getProfileCount(): number {
    return this.profiles.size;
  }

  async validateProfile(
    id: string
  ): Promise<{ valid: boolean; error?: string }> {
    const profile = this.profiles.get(id);
    if (!profile) {
      return { valid: false, error: 'Profile not found' };
    }

    if (!profile.apiKey && !profile.config?.accessToken) {
      return { valid: false, error: 'No API key or access token configured' };
    }

    if (!profile.baseUrl) {
      return { valid: false, error: 'No base URL configured' };
    }

    return { valid: true };
  }

  exportProfile(id: string): Omit<AuthProfile, 'apiKey'> | null {
    const profile = this.profiles.get(id);
    if (!profile) return null;

    const { apiKey: _key, ...rest } = profile;
    return rest;
  }

  importProfile(
    profile: Omit<
      AuthProfile,
      'id' | 'createdAt' | 'updatedAt' | 'isActive'
    > & { id?: string }
  ): AuthProfile {
    const id = profile.id ?? `${profile.provider}_imported_${Date.now()}`;

    if (this.profiles.has(id)) {
      throw new AppError(
        `Profile with id "${id}" already exists`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'ENTITY_EXISTS',
        { profileId: id }
      );
    }

    const now = Date.now();
    const newProfile: AuthProfile = {
      ...profile,
      id,
      isActive: false,
      createdAt: now,
      updatedAt: now,
    };

    this.profiles.set(id, newProfile);
    return newProfile;
  }

  clear(): void {
    this.profiles.clear();
    this.activeProfileId = null;
  }

  toJSON(): Array<Omit<AuthProfile, 'apiKey'>> {
    return Array.from(this.profiles.values()).map(
      (p) => this.exportProfile(p.id)!
    );
  }
}

export function createAuthProfileManager(
  config?: AuthProfileManagerConfig
): AuthProfileManager {
  return new AuthProfileManager(config);
}
