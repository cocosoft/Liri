/**
 * 团队记忆网络版 Phase 2N-4（2026-11-25）：退避重试分类 + 审计留痕。
 *
 * 规格：`.trae/specs/team-memory-sync.md` §3.7 / §4.2 / §4.3
 * 覆盖：1×/2×/4× 退避（上限 15min）· 只有 429/5xx/网络错误可重试 ·
 * 每轮落 `sync-history.jsonl` · ERROR 保留 lastError。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AppError, ErrorCategory, ErrorSeverity } from '@openliri/infra/error';
import {
  computeTeamMemorySyncRetryDelay,
  isRetriableTeamMemorySyncError,
  SyncStatus,
  TeamMemorySyncService,
} from '@openliri/infra/memory/services/TeamMemorySyncService';
import { TeamMemorySyncStateStore } from '@openliri/infra/memory/services/TeamMemorySyncStateStore';

const originalFetch = globalThis.fetch;
const createdDirs: string[] = [];

function makeDirs(): {
  localDir: string;
  store: TeamMemorySyncStateStore;
} {
  const root = mkdtempSync(join(tmpdir(), 'team-sync-backoff-'));
  createdDirs.push(root);
  return {
    localDir: root,
    store: new TeamMemorySyncStateStore(join(root, 'app.db')),
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (!dir) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响断言
    }
  }
});

function installFetch(status: number): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ memories: [] }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
}

function makeService(
  localDir: string,
  store: TeamMemorySyncStateStore
): TeamMemorySyncService {
  return new TeamMemorySyncService(
    {
      serverUrl: 'http://srv.test',
      teamId: 'team-b',
      localDir,
      syncInterval: 300_000,
    },
    store
  );
}

describe('退避重试（§3.7 / §4.2）', () => {
  it('1×/2×/4× 退避，上限 15 分钟', () => {
    const interval = 300_000; // 5 分钟
    expect(computeTeamMemorySyncRetryDelay(1, interval)).toBe(300_000);
    expect(computeTeamMemorySyncRetryDelay(2, interval)).toBe(600_000);
    expect(computeTeamMemorySyncRetryDelay(3, interval)).toBe(900_000); // 4× = 20min ⇒ 截 15min
    expect(computeTeamMemorySyncRetryDelay(10, interval)).toBe(900_000);
  });

  it('非法间隔 ⇒ 回退默认 5 分钟（不产生 NaN/0）', () => {
    expect(computeTeamMemorySyncRetryDelay(1, Number.NaN)).toBe(300_000);
    expect(computeTeamMemorySyncRetryDelay(1, 0)).toBe(300_000);
  });

  it('只有 429/5xx/网络错误可重试；401/403 不重试', () => {
    expect(
      isRetriableTeamMemorySyncError(
        new AppError(
          'x',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          'RATE_LIMITED'
        )
      )
    ).toBe(true);
    expect(
      isRetriableTeamMemorySyncError(
        new AppError(
          'x',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          'SERVER_ERROR'
        )
      )
    ).toBe(true);
    expect(
      isRetriableTeamMemorySyncError(
        new AppError(
          'x',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          'UNAUTHORIZED'
        )
      )
    ).toBe(false);
    expect(isRetriableTeamMemorySyncError(new TypeError('fetch failed'))).toBe(
      true
    );
  });
});

describe('审计与 lastError（§4.3）', () => {
  it('成功同步 ⇒ sync-history.jsonl 记录 pushed/errors', async () => {
    const { localDir, store } = makeDirs();
    writeFileSync(join(localDir, 'm1.md'), 'BODY', 'utf-8');
    installFetch(200); // 列表空 ⇒ 本地条目走上传

    const result = await makeService(localDir, store).sync();

    expect(result.success).toBe(true);
    const lines = readFileSync(join(localDir, 'sync-history.jsonl'), 'utf-8')
      .split('\n')
      .filter((line) => line.trim());
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]) as {
      pushed: number;
      pulled: number;
      errors: number;
    };
    expect(record.pushed).toBe(1);
    expect(record.pulled).toBe(0);
    expect(record.errors).toBe(0);
  });

  it('401 ⇒ ERROR 且有 lastError（含 UNAUTHORIZED）', async () => {
    const { localDir, store } = makeDirs();
    installFetch(401);

    const service = makeService(localDir, store);
    const result = await service.sync();

    expect(result.success).toBe(false);
    expect(service.getStatus()).toBe(SyncStatus.ERROR);
    expect(service.getLastError() ?? '').toContain('UNAUTHORIZED');
  });
});
