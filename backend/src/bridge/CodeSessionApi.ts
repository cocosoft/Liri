/**
 * 代码会话 API
 *
 * 为 Bridge 提供代码会话的 CRUD 操作 HTTP 封装
 * 支持创建、查询、更新、删除代码会话
 *
 * 参考: cc_code/backend/bridge/codeSessionApi.ts
 */

import { logForDebugging } from '../utils/debug.js';
import { errorMessage } from '../utils/errors.js';
import { jsonStringify } from '../utils/json.js';

const ANTHROPIC_VERSION = '2023-06-01';

function oauthHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
  };
}

function extractErrorDetail(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.error === 'string') return d.error;
  if (d.error && typeof d.error === 'object') {
    const e = d.error as Record<string, unknown>;
    return (typeof e.message === 'string' ? e.message : null) ?? null;
  }
  return null;
}

export async function createCodeSession(
  baseUrl: string,
  accessToken: string,
  title: string,
  timeoutMs: number,
  tags?: string[]
): Promise<string | null> {
  const url = `${baseUrl}/v1/code/sessions`;

  let response: { status: number; data: unknown };
  try {
    const fetchFn =
      typeof fetch !== 'undefined'
        ? fetch
        : (await import('node-fetch')).default;
    response = await fetchFn(url, {
      method: 'POST',
      headers: {
        ...oauthHeaders(accessToken),
      },
      body: jsonStringify({
        title,
        bridge: {},
        ...(tags?.length ? { tags } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    }).then(async (r) => ({
      status: r.status,
      data: await r.json().catch(() => null),
    }));
  } catch (err: unknown) {
    logForDebugging(
      `[code-session] Session create request failed: ${errorMessage(err)}`
    );
    return null;
  }

  if (response.status !== 200 && response.status !== 201) {
    const detail = extractErrorDetail(response.data);
    logForDebugging(
      `[code-session] Session create failed ${response.status}${detail ? `: ${detail}` : ''}`
    );
    return null;
  }

  const data = response.data as Record<string, unknown> | null;
  if (
    !data ||
    typeof data !== 'object' ||
    !('session' in data) ||
    !data.session ||
    typeof data.session !== 'object'
  ) {
    logForDebugging(
      `[code-session] No session in response: ${jsonStringify(data).slice(0, 200)}`
    );
    return null;
  }

  const session = data.session as Record<string, unknown>;
  const id = session.id;
  return typeof id === 'string' ? id : null;
}

export async function getCodeSession(
  baseUrl: string,
  accessToken: string,
  sessionId: string,
  timeoutMs: number
): Promise<Record<string, unknown> | null> {
  const url = `${baseUrl}/v1/code/sessions/${sessionId}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: oauthHeaders(accessToken),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      logForDebugging(`[code-session] Get session failed ${response.status}`);
      return null;
    }

    return (await response.json()) as Record<string, unknown>;
  } catch (err: unknown) {
    logForDebugging(
      `[code-session] Get session request failed: ${errorMessage(err)}`
    );
    return null;
  }
}

export async function updateCodeSessionTitle(
  baseUrl: string,
  accessToken: string,
  sessionId: string,
  title: string,
  timeoutMs: number
): Promise<boolean> {
  const url = `${baseUrl}/v1/code/sessions/${sessionId}`;

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: oauthHeaders(accessToken),
      body: jsonStringify({ title }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    return response.ok;
  } catch (err: unknown) {
    logForDebugging(
      `[code-session] Update session failed: ${errorMessage(err)}`
    );
    return false;
  }
}

export async function deleteCodeSession(
  baseUrl: string,
  accessToken: string,
  sessionId: string,
  timeoutMs: number
): Promise<boolean> {
  const url = `${baseUrl}/v1/code/sessions/${sessionId}`;

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: oauthHeaders(accessToken),
      signal: AbortSignal.timeout(timeoutMs),
    });

    return response.ok;
  } catch (err: unknown) {
    logForDebugging(
      `[code-session] Delete session failed: ${errorMessage(err)}`
    );
    return false;
  }
}

export async function listCodeSessions(
  baseUrl: string,
  accessToken: string,
  timeoutMs: number,
  limit = 50
): Promise<Array<{ id: string; title?: string; status?: string }>> {
  const url = `${baseUrl}/v1/code/sessions?limit=${limit}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: oauthHeaders(accessToken),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) return [];

    const data = (await response.json()) as Record<string, unknown>;
    const sessions = data.sessions;
    if (!Array.isArray(sessions)) return [];

    return sessions.map((s: Record<string, unknown>) => ({
      id: typeof s.id === 'string' ? s.id : '',
      title: typeof s.title === 'string' ? s.title : undefined,
      status: typeof s.status === 'string' ? s.status : undefined,
    }));
  } catch (err: unknown) {
    logForDebugging(
      `[code-session] List sessions failed: ${errorMessage(err)}`
    );
    return [];
  }
}
