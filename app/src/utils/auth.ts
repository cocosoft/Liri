/**
 * 认证工具
 *
 * 提供 API Key 和 OAuth Token 的管理能力。
 * 参考 CC源码 cc_code/backend/utils/auth.ts
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { resolvePyappHome } from '@modules/core';
import { randomUUID } from 'crypto';
import { configManager } from '@modules/config';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'utils:auth', level: LogLevel.INFO });

export interface AuthSession {
  oauthToken: string;
  apiKey?: string;
  expiresAt?: Date;
  sessionId: string;
  refreshToken?: string;
}

export interface AuthConfig {
  apiKey?: string;
  oauthToken?: string;
  baseUrl?: string;
}

const CONFIG_DIR = resolvePyappHome();
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const SESSION_FILE = join(CONFIG_DIR, 'session.json');

function resolveApiKeyFromEnv(): string | undefined {
  return (
    configManager.env('LIRI_AI_API_KEY') || configManager.env('Liri_API_KEY')
  );
}

function resolveApiKeyFromConfig(config: AuthConfig): string | undefined {
  return config.apiKey;
}

export async function resolveApiKey(): Promise<string | undefined> {
  const envKey = resolveApiKeyFromEnv();
  if (envKey) return envKey;

  const config = await loadAuthConfig();
  return resolveApiKeyFromConfig(config);
}

export async function resolveAuthToken(): Promise<string | undefined> {
  const session = await loadSession();
  if (session?.oauthToken) {
    if (session.expiresAt && new Date(session.expiresAt) > new Date()) {
      return session.oauthToken;
    }
  }
  return undefined;
}

export async function loadAuthConfig(): Promise<AuthConfig> {
  try {
    if (existsSync(CONFIG_FILE)) {
      const data = await readFile(CONFIG_FILE, 'utf-8');
      return JSON.parse(data) as AuthConfig;
    }
  } catch (err) {
    // 配置文件不存在或格式错误时返回空配置

    logger.debug('Operation skipped', {
      context: '配置文件不存在或格式错误时返回空配置',
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return {};
}

export async function saveAuthConfig(config: AuthConfig): Promise<void> {
  const dir = dirname(CONFIG_FILE);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export async function loadSession(): Promise<AuthSession | null> {
  try {
    if (existsSync(SESSION_FILE)) {
      const data = await readFile(SESSION_FILE, 'utf-8');
      return JSON.parse(data) as AuthSession;
    }
  } catch (err) {
    // 会话文件异常时返回 null

    logger.debug('Operation skipped', {
      context: '会话文件异常时返回 null',
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return null;
}

export async function saveSession(session: AuthSession): Promise<void> {
  const dir = dirname(SESSION_FILE);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(SESSION_FILE, JSON.stringify(session, null, 2), 'utf-8');
}

export async function clearSession(): Promise<void> {
  try {
    if (existsSync(SESSION_FILE)) {
      await writeFile(SESSION_FILE, JSON.stringify({}), 'utf-8');
    }
  } catch (err) {
    // 清理失败时静默处理

    logger.warn('Operation skipped', {
      context: '清理失败时静默处理',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function createSession(
  oauthToken: string,
  apiKey?: string,
  expiresInMs?: number
): AuthSession {
  return {
    oauthToken,
    apiKey,
    expiresAt: expiresInMs ? new Date(Date.now() + expiresInMs) : undefined,
    sessionId: randomUUID(),
  };
}

export async function refreshOAuthToken(
  refreshToken: string,
  baseUrl: string = 'https://auth.openliri.com'
): Promise<AuthSession | null> {
  try {
    const response = await fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const session = createSession(
      data.access_token,
      undefined,
      data.expires_in ? data.expires_in * 1000 : undefined
    );

    if (data.refresh_token) {
      session.refreshToken = data.refresh_token;
    }

    await saveSession(session);
    return session;
  } catch {
    return null;
  }
}

export function clearAuthConfig(): void {
  const envVars = ['LIRI_AI_API_KEY', 'Liri_API_KEY'];
  for (const envVar of envVars) {
    delete process.env[envVar];
  }
}
