/**
 * P0-1 补全（2026-11-25）：写入后重建顶层索引 + 会话冻结快照失效。
 *
 * 修复的断点：`MEMORY.md` 原先只在维护期/清理期重建 ⇒ 注入层（每轮读该文件）
 * 在新写入之后、下次空闲维护之前读不到新条目；且 `memoryContext` 的 1h 冻结快照
 * 会让记忆写入后继续注入旧内容。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryManagerImpl } from '@openliri/infra/memory/MemoryManager';
import { createMemoryMetadata } from '@openliri/infra/memory/types/MemoryMetadata';
import {
  getFrozenSnapshotService,
  resetFrozenSnapshotService,
} from '@openliri/infra/memory/FrozenSnapshotService';

const createdDirs: string[] = [];

function makeMemoryRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'memory-write-index-'));
  createdDirs.push(dir);
  mkdirSync(join(dir, 'global'), { recursive: true });
  return dir;
}

/** 等待索引重建完成（写入后防抖 200ms；轮询上限 3s，避免固定 sleep 造成的抖动） */
async function waitForIndex(
  root: string,
  predicate: (text: string) => boolean
): Promise<string> {
  const indexPath = join(root, 'global', 'MEMORY.md');
  const deadline = Date.now() + 3000;
  let last = '';
  while (Date.now() < deadline) {
    if (existsSync(indexPath)) {
      last = readFileSync(indexPath, 'utf-8');
      if (predicate(last)) return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`索引未在超时内重建，最后一次内容：\n${last}`);
}

beforeEach(() => {
  resetFrozenSnapshotService();
});

afterEach(() => {
  resetFrozenSnapshotService();
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

describe('写入后重建顶层索引（MEMORY.md）', () => {
  it('createMemory 后无需等维护期即可在索引中看到新条目', async () => {
    const root = makeMemoryRoot();
    const manager = new MemoryManagerImpl(root);

    await manager.createMemory({
      content: '用户偏好中文回答',
      metadata: createMemoryMetadata({
        name: '用户偏好',
        description: '中文回答',
        type: 'user_fact',
      }),
    });

    const index = await waitForIndex(root, (text) =>
      text.includes('[用户偏好](')
    );
    expect(index).toContain('共 1 条');
  });

  it('updateMemory 后索引钩子同步为最新描述', async () => {
    const root = makeMemoryRoot();
    const manager = new MemoryManagerImpl(root);

    const memory = await manager.createMemory({
      content: '提交前先跑 typecheck',
      metadata: createMemoryMetadata({
        name: '提交流程',
        description: '先门禁后提交',
        type: 'decision',
      }),
    });
    await waitForIndex(root, (text) => text.includes('先门禁后提交'));

    await manager.updateMemory(memory.id, {
      metadata: { ...memory.metadata, description: '先门禁再提交' },
    });

    await waitForIndex(root, (text) => text.includes('先门禁再提交'));
  });

  it('deleteMemory 后索引不再列出该条目', async () => {
    const root = makeMemoryRoot();
    const manager = new MemoryManagerImpl(root);

    const memory = await manager.createMemory({
      content: '临时记忆',
      metadata: createMemoryMetadata({
        name: '临时条目',
        description: '待删除',
        type: 'conversation',
      }),
    });
    await waitForIndex(root, (text) => text.includes('[临时条目]('));

    await manager.deleteMemory(memory.id);

    const index = await waitForIndex(
      root,
      (text) => !text.includes('[临时条目](')
    );
    expect(index).toContain('共 0 条');
  });
});

describe('写入后会话冻结快照失效', () => {
  it('createMemory 立即解冻（不再等 1h TTL 或启动期 unfreezeAll）', async () => {
    const root = makeMemoryRoot();
    const manager = new MemoryManagerImpl(root);

    const frozen = getFrozenSnapshotService();
    frozen.freeze('s1', '## 记忆上下文\n\n旧内容');
    expect(frozen.getFrozen('s1')).toBe('## 记忆上下文\n\n旧内容');

    await manager.createMemory({
      content: '新的偏好',
      metadata: createMemoryMetadata({
        name: '新偏好',
        type: 'user_fact',
      }),
    });

    expect(frozen.getFrozen('s1')).toBeNull();
  });
});
