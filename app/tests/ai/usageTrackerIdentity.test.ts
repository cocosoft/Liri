/**
 * 多租户 P5：UsageTracker 的"身份相关实例"必须**每次按调用时身份**解析
 *
 * 回归的是接线缺陷：`ai/UsageTracker.ts` 曾在模块级缓存首个身份解析出的
 * `getLLMTracker()` / `getCostRecordRepository()` 实例。于是后续所有身份的 LLM 调用
 * 记录都写进那一个库 —— 该身份读监控面板时会看到别人的会话（跨身份串库）。
 *
 * 本文件用**两个身份各记一次**调用，断言各自的跟踪器只看到自己的会话；
 * 若把模块级缓存加回去，A 的会话会出现在 B 的列表里 ⇒ 用例变红。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { setUserDataDirOverride } from '@modules/core/paths.js';
import { runWithPrincipal } from '@modules/core/identity/requestScope.js';
import type { Principal } from '@modules/core/identity/principal.js';
import { trackUsage } from '../../src/ai/UsageTracker.js';
import { getLLMTracker } from '../../src/monitoring/llm/getLLMTracker.js';

// 用**本文件独有**的租户标识：`getLLMTracker()` 的分身份实例是**进程级缓存**，
// 若借用其他用例的 `acme:alice`，会把"库已按别的临时数据根开过"的实例带进那些用例
// （`tenantDbPartition` 断言分区库文件存在，会因此变红）。
const ALICE: Principal = {
  tenantId: 'usage-fixture-a',
  userId: 'alice',
  roles: ['user'],
};
const BOB: Principal = {
  tenantId: 'usage-fixture-b',
  userId: 'bob',
  roles: ['user'],
};

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-usage-tracker-'));
  setUserDataDirOverride(root);
});

afterEach(() => {
  setUserDataDirOverride(null);
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // @ignore-catch — Windows 句柄延迟释放时清理失败不影响断言
  }
});

const RESPONSE = {
  content: 'ok',
  usage: { prompt_tokens: 11, completion_tokens: 7 },
};

describe('UsageTracker：LLM 会话按身份隔离', () => {
  it('A 的调用只出现在 A 的跟踪器里（B 的同名断言为空）', async () => {
    await runWithPrincipal(ALICE, () =>
      trackUsage(RESPONSE, { model: 'gpt-4o', sessionId: 's-alice' })
    );
    await runWithPrincipal(BOB, () =>
      trackUsage(RESPONSE, { model: 'gpt-4o', sessionId: 's-bob' })
    );

    const aliceSessions = runWithPrincipal(ALICE, () =>
      getLLMTracker()
        .getAllSessions()
        .map((s) => s.sessionId)
    );
    const bobSessions = runWithPrincipal(BOB, () =>
      getLLMTracker()
        .getAllSessions()
        .map((s) => s.sessionId)
    );

    expect(aliceSessions).toContain('s-alice');
    expect(aliceSessions).not.toContain('s-bob');
    expect(bobSessions).toContain('s-bob');
    expect(bobSessions).not.toContain('s-alice');
  });
});
