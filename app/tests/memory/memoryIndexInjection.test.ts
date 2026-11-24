/**
 * P0-1（2026-11-25）长期记忆顶层索引 —— 生成与注入段单测。
 *
 * 规格：`.trae/specs/agent-memory-optimization.md` §4 P0-1
 * 覆盖：空态零注入 · 条目/总数渲染 · 行数上限截断（含载入条数提示）· 维护期重建紧凑索引。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildMemoryIndexSection } from '@openliri/infra/memory';
import { MemoryManagerImpl } from '@openliri/infra/memory/MemoryManager';
import { createMemoryMetadata } from '@openliri/infra/memory/types/MemoryMetadata';

const createdDirs: string[] = [];

function makeMemoryRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'memory-index-'));
  createdDirs.push(dir);
  mkdirSync(join(dir, 'global'), { recursive: true });
  return dir;
}

function writeIndex(root: string, content: string): void {
  writeFileSync(join(root, 'global', 'MEMORY.md'), content, 'utf-8');
}

afterEach(() => {
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

describe('buildMemoryIndexSection', () => {
  it('索引缺失 ⇒ 空串（空态零注入）', () => {
    expect(buildMemoryIndexSection({ memoryDir: makeMemoryRoot() })).toBe('');
  });

  it('索引为空/无条目 ⇒ 空串', () => {
    const root = makeMemoryRoot();
    writeIndex(root, '# Memory Index\n\n> 自动生成\n');
    expect(buildMemoryIndexSection({ memoryDir: root })).toBe('');
  });

  it('有条目 ⇒ 渲染索引 + 总数 + 召回提示', () => {
    const root = makeMemoryRoot();
    writeIndex(
      root,
      [
        '# Memory Index',
        '',
        '- [用户偏好](a.md) — 偏好中文回答',
        '- [发布流程](b.md) — 先跑门禁再提交',
      ].join('\n')
    );

    const section = buildMemoryIndexSection({ memoryDir: root });

    expect(section).toContain('## 长期记忆索引');
    expect(section).toContain('- [用户偏好](a.md) — 偏好中文回答');
    expect(section).toContain('共 2 条长期记忆');
    expect(section).toContain('recall_memory');
  });

  it('超出 maxLines ⇒ 截断并如实提示"只载入 N 条"', () => {
    const root = makeMemoryRoot();
    const entries = Array.from(
      { length: 30 },
      (_, i) => `- [条目${i}](m${i}.md) — hook ${i}`
    );
    writeIndex(root, ['# Memory Index', '', ...entries].join('\n'));

    const section = buildMemoryIndexSection({
      memoryDir: root,
      maxLines: 10,
      maxBytes: 25_000,
    });

    expect(section).toContain('共 30 条长期记忆');
    expect(section).toContain('上面只载入最近');
    expect(section).toContain('MEMORY.md');
  });
});

describe('维护期重建索引（runMaintenancePass → MEMORY.md）', () => {
  it('每条记忆一行：`- [标题](id.md) — 钩子`', async () => {
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
    await manager.createMemory({
      content: '提交前先跑 typecheck',
      metadata: createMemoryMetadata({
        name: '提交流程',
        description: '先门禁后提交',
        type: 'decision',
      }),
    });

    await manager.runMaintenancePass();

    const index = readFileSync(join(root, 'global', 'MEMORY.md'), 'utf-8');
    const entryLines = index
      .split('\n')
      .filter((line) => line.startsWith('- ['));

    expect(index).toContain('共 2 条');
    expect(entryLines).toHaveLength(2);
    expect(entryLines.some((l) => l.includes('[用户偏好]('))).toBe(true);
    expect(entryLines.some((l) => l.includes('[提交流程]('))).toBe(true);
    expect(entryLines.every((l) => l.includes(' — '))).toBe(true);
  });

  it('P2-1：按价值排序（重要度优先），已过期条目不上榜', async () => {
    const root = makeMemoryRoot();
    const manager = new MemoryManagerImpl(root);

    await manager.createMemory({
      content: '低价值的新记忆',
      metadata: createMemoryMetadata({
        name: '低价值',
        type: 'conversation',
        importance: 0.2,
      }),
    });
    await manager.createMemory({
      content: '高价值的旧记忆',
      metadata: createMemoryMetadata({
        name: '高价值',
        type: 'decision',
        importance: 0.9,
      }),
    });
    await manager.createMemory({
      content: '已过期记忆',
      metadata: createMemoryMetadata({
        name: '过期',
        type: 'conversation',
        expiresAt: new Date(Date.now() - 86_400_000),
      }),
    });

    await manager.runMaintenancePass();

    const index = readFileSync(join(root, 'global', 'MEMORY.md'), 'utf-8');
    const entryLines = index
      .split('\n')
      .filter((line) => line.startsWith('- ['));

    expect(index).toContain('共 2 条');
    expect(index).not.toContain('[过期](');
    expect(entryLines[0]).toContain('[高价值](');
    expect(entryLines[1]).toContain('[低价值](');
  });
});
