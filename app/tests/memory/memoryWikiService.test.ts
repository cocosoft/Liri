/**
 * P2-1（2026-11-25）记忆表示层（wiki）单测。
 *
 * 规格：`.trae/specs/agent-memory-optimization.md` §4 P2-1（Represent）
 * 覆盖：按类型生成主题页 + 链接指向原文件 · 悬空链接不写 · 只清理自己生成的旧页 ·
 * 体积上限退化（去钩子）。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Memory } from '@openliri/infra/memory/types/Memory';
import { rebuildMemoryWiki } from '@openliri/infra/memory/services/MemoryWikiService';

const createdDirs: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'memory-wiki-'));
  createdDirs.push(root);
  mkdirSync(join(root, 'memory', 'global'), { recursive: true });
  return root;
}

function makeMemory(
  id: string,
  type: string,
  name: string,
  content: string,
  description = ''
): Memory {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id,
    content,
    metadata: {
      name,
      description,
      type,
      createdAt: now,
      updatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
}

/** 在 global/ 下写一个记忆文件（链接完整性检查用） */
function writeMemoryFile(root: string, id: string): void {
  writeFileSync(
    join(root, 'memory', 'global', `${id}.md`),
    `# ${id}\n`,
    'utf-8'
  );
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

describe('rebuildMemoryWiki（P2-1 Represent）', () => {
  it('按类型生成主题页，链接指向原文件；INDEX 链接各主题页', async () => {
    const root = makeRoot();
    const memoryDir = join(root, 'memory');
    writeMemoryFile(root, 'm1');
    writeMemoryFile(root, 'm2');

    const report = await rebuildMemoryWiki(memoryDir, [
      makeMemory('m1', 'decision', '发布流程', '先跑门禁再提交', '门禁优先'),
      makeMemory('m2', 'user_fact', '用户偏好', '偏好中文', '中文回答'),
    ]);

    const index = readFileSync(
      join(memoryDir, 'global', 'wiki', 'INDEX.md'),
      'utf-8'
    );
    const page = readFileSync(
      join(memoryDir, 'global', 'wiki', 'decision.md'),
      'utf-8'
    );

    expect(report.pages).toBe(2);
    expect(report.entries).toBe(2);
    expect(report.droppedLinks).toBe(0);
    expect(index).toContain('decision.md');
    expect(index).toContain('user_fact.md');
    expect(page).toContain('(../m1.md)');
    expect(page).toContain('— 门禁优先');
  });

  it('目标文件不存在 ⇒ 不写该链接（droppedLinks 计数）', async () => {
    const root = makeRoot();
    const memoryDir = join(root, 'memory');
    writeMemoryFile(root, 'm1');

    const report = await rebuildMemoryWiki(memoryDir, [
      makeMemory('m1', 'decision', '有文件', '内容 A'),
      makeMemory('m2', 'decision', '无文件', '内容 B'),
    ]);

    const page = readFileSync(
      join(memoryDir, 'global', 'wiki', 'decision.md'),
      'utf-8'
    );
    expect(report.droppedLinks).toBe(1);
    expect(page).toContain('(../m1.md)');
    expect(page).not.toContain('(../m2.md)');
  });

  it('只清理自己生成的旧页面（用户手写文件保留）', async () => {
    const root = makeRoot();
    const memoryDir = join(root, 'memory');
    writeMemoryFile(root, 'm1');
    const wikiDir = join(memoryDir, 'global', 'wiki');
    mkdirSync(wikiDir, { recursive: true });
    writeFileSync(
      join(wikiDir, 'old_type.md'),
      '<!-- generated-by: memory-wiki -->\n# old\n',
      'utf-8'
    );
    writeFileSync(join(wikiDir, 'user_note.md'), '# 手写笔记\n', 'utf-8');

    await rebuildMemoryWiki(memoryDir, [
      makeMemory('m1', 'decision', '有文件', '内容 A'),
    ]);

    expect(existsSync(join(wikiDir, 'old_type.md'))).toBe(false);
    expect(existsSync(join(wikiDir, 'user_note.md'))).toBe(true);
  });

  it('超出体积上限 ⇒ 退化为无钩子并标记 truncated', async () => {
    const root = makeRoot();
    const memoryDir = join(root, 'memory');
    const memories: Memory[] = [];
    for (let i = 0; i < 60; i++) {
      const id = `t${i}`;
      writeMemoryFile(root, id);
      // 正文极小、描述很长 ⇒ 带钩子的 wiki 会超过"源正文 × 1.2"
      memories.push(makeMemory(id, 'tiny', `条目${i}`, 'x', 'd'.repeat(300)));
    }

    const report = await rebuildMemoryWiki(memoryDir, memories);

    expect(report.truncated).toBe(true);
    const page = readFileSync(
      join(memoryDir, 'global', 'wiki', 'tiny.md'),
      'utf-8'
    );
    expect(page).not.toContain(' — ');
  });
});
