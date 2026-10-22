/**
 * 供应商凭据缺失的 fail-fast（2026-10-22）
 *
 * 实测缺陷：DB `ai_providers.api_key` 是 `__stored__`（占位符）但
 * `~/.pyapp/credentials.json` 里没有该 provider 的条目时，`recordToConfig` 会**静默回落空串**
 * ⇒ `OpenAIProvider` 拼出 `Authorization: Bearer `（空值）发到上游 ⇒ 用户看到
 * `OpenAI stream error (401): Authentication Fails (auth header format should be Bearer sk-...)`。
 *
 * 现口径：
 *   - `needsCredentialRepair`：唯一判据（占位符 && 凭据文件无条目）；
 *   - `recordToConfig`：命中判据 ⇒ 抛可读 `AppError`（含供应商名 + 修复路径），不再发空 Bearer；
 *   - 同步侧：跳过注册（不造空凭据实例）；调用侧：`aiService.assertCredentialReady` 兜底。
 *
 * 本文件只锁"判据 + 抛错文案 + 不误伤"三件事（真库/真网络不参与）。
 */
import { describe, it, expect } from 'bun:test';
import { randomUUID } from 'crypto';

import {
  missingCredentialMessage,
  needsCredentialRepair,
  recordToConfig,
} from '../../src/ai/providers/ProviderSyncService.js';
import { CRED_STORED_MARKER } from '../../src/ai/credentials/CredentialStore.js';
import type { ProviderRecord } from '../../src/ai/providers/ProviderManager.js';

/**
 * 构造一条 provider 记录。
 *
 * `id` 用**随机 UUID**：保证凭据文件里**一定没有**该条目 ⇒ 不依赖本机
 * `~/.pyapp/credentials.json` 的实际内容（CI 无该文件、本机有也无关）。
 */
function makeRecord(over: Partial<ProviderRecord> = {}): ProviderRecord {
  return {
    id: `missing-cred-${randomUUID()}`,
    name: 'SiliconFlow',
    providerType: 'siliconflow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKey: CRED_STORED_MARKER,
    ...over,
  } as unknown as ProviderRecord;
}

describe('needsCredentialRepair：唯一判据', () => {
  it('仅「占位符 + 凭据缺失」为真；空 key 的自建/本地供应商不被误判', () => {
    expect(needsCredentialRepair({ apiKey: CRED_STORED_MARKER }, false)).toBe(
      true
    );
    expect(needsCredentialRepair({ apiKey: CRED_STORED_MARKER }, true)).toBe(
      false
    );
    expect(needsCredentialRepair({ apiKey: '' }, false)).toBe(false);
    expect(needsCredentialRepair({ apiKey: 'sk-plain-legacy' }, false)).toBe(
      false
    );
  });
});

describe('recordToConfig：占位符 + 凭据缺失 ⇒ 抛可读错误', () => {
  it('错误文案含供应商名与修复路径（不再是上游 401 英文）', () => {
    let message = '';
    try {
      recordToConfig(makeRecord());
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toBe(missingCredentialMessage('SiliconFlow'));
    expect(message).toContain('SiliconFlow');
    expect(message).toContain('API Key');
    expect(message).toContain('模型管理');
  });

  it('不误伤：`api_key` 本来为空的自建供应商照常返回', () => {
    const config = recordToConfig(
      makeRecord({ apiKey: '', name: '自建网关', providerType: 'openai' })
    );
    expect(config.apiKey).toBe('');
    expect(config.baseUrl).toBe('https://api.siliconflow.cn/v1');
  });

  it('不误伤：历史明文 key 原样透传', () => {
    const config = recordToConfig(makeRecord({ apiKey: 'sk-plain-legacy' }));
    expect(config.apiKey).toBe('sk-plain-legacy');
  });
});
