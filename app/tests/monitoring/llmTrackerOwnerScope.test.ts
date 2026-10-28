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
 * 租户级 DB 期 3：`LLMTracker` 的**行级隔离**（基础设施专项 §6.1）。
 *
 * 两层都要隔离：
 *  ① DB：`llm_call_records` 主键 `(request_id, owner_key)` + 恢复查询带 owner；
 *  ② 内存：统计 Map 的键带 owner 前缀（租户内共用实例，同名会话不得混算）。
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope';
import { openBunDatabase } from '@modules/external';
import {
  getLLMTracker,
  resetLLMTrackerForTest,
} from '../../src/monitoring/llm/getLLMTracker';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

const dataDir = mkdtempSync(join(tmpdir(), 'llm-tracker-'));

// bun test 同进程串行跑多个文件 ⇒ 其它用例会改写该环境变量，并可能已缓存了指向别的
// 临时目录的租户实例 ⇒ 进本文件时重置一次缓存，每个用例前重新钉住 env。
beforeAll(() => {
  process.env.LIRI_DATA_DIR = dataDir;
  resetLLMTrackerForTest();
});

beforeEach(() => {
  process.env.LIRI_DATA_DIR = dataDir;
});

afterAll(() => {
  resetLLMTrackerForTest();
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows：句柄释放滞后 ⇒ 交给系统临时目录清理
  }
});

const record = (requestId: string, inputTokens: number) => {
  getLLMTracker().recordLLMCall({
    sessionId: 's-shared',
    requestId,
    model: 'm',
    provider: 'p',
    inputTokens,
    outputTokens: 1,
    costUsd: 0.01,
    durationMs: 5,
  });
};

describe('LLMTracker：行级隔离', () => {
  it('内存统计各记各的（同名会话不混算）', async () => {
    await runWithPrincipal(ALICE, () => record('req-a', 10));
    await runWithPrincipal(BOB, () => record('req-b', 20));

    const alice = await runWithPrincipal(ALICE, () =>
      getLLMTracker().getSessionStats('s-shared')
    );
    const bob = await runWithPrincipal(BOB, () =>
      getLLMTracker().getSessionStats('s-shared')
    );
    expect(alice?.totalRequests).toBe(1);
    expect(alice?.totalInputTokens).toBe(10);
    expect(bob?.totalRequests).toBe(1);
    expect(bob?.totalInputTokens).toBe(20);

    expect(
      (await runWithPrincipal(ALICE, () => getLLMTracker().getAllSessions()))
        .length
    ).toBe(1);
    const summary = await runWithPrincipal(ALICE, () =>
      getLLMTracker().getGlobalSummary()
    );
    expect(summary.totalSessions).toBe(1);
    expect(summary.totalRequests).toBe(1);
  });

  it('clearAll 只清自己的', async () => {
    await runWithPrincipal(ALICE, () => getLLMTracker().clearAll());
    expect(
      await runWithPrincipal(ALICE, () =>
        getLLMTracker().getSessionStats('s-shared')
      )
    ).toBeNull();
    expect(
      (
        await runWithPrincipal(BOB, () =>
          getLLMTracker().getSessionStats('s-shared')
        )
      )?.totalRequests
    ).toBe(1);
  });

  it('DB 行带各自 owner_key', async () => {
    const raw = openBunDatabase(join(dataDir, 'tenants', 'acme', 'app.db'), {
      readonly: true,
    });
    const rows = raw
      .prepare(
        `SELECT owner_key, request_id FROM llm_call_records ORDER BY owner_key`
      )
      .all() as Array<{ owner_key: string; request_id: string }>;
    raw.close();

    expect(rows.map((r) => `${r.owner_key}/${r.request_id}`)).toEqual([
      'acme:alice/req-a',
      'acme:bob/req-b',
    ]);
  });
});

describe('门禁：LLMTracker 的读写 SQL 不许漏 owner_key', () => {
  it('SELECT / INSERT 模板都必须带 owner_key，且主键含 owner_key', () => {
    const src = readFileSync(
      new URL('../../src/monitoring/llm/LLMTracker.ts', import.meta.url),
      'utf8'
    );
    const templates = [
      ...src.matchAll(/`[^`]*\bllm_call_records\b[^`]*`/g),
    ].map((m) => m[0]);
    const rowSql = templates.filter((sql) =>
      /\b(SELECT|INSERT|UPDATE|DELETE)\b/.test(sql)
    );

    expect(rowSql.length).toBeGreaterThanOrEqual(2);
    for (const sql of rowSql) expect(sql).toContain('owner_key');

    expect(src).toContain('PRIMARY KEY (request_id, owner_key)');
  });
});
