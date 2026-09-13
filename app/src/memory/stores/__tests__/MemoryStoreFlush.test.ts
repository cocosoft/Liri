/**
 * MemoryStore.flushBatch 修复回归测试（预存错误 #57-1）
 *
 * 根因：gray-matter `matter.stringify(contentString, fm)` 对字符串首参会先 parse
 * （gray-matter/index.js L161），content 首行 `---page-break---` 被误判为
 * frontmatter language → "gray-matter engine page-break--- is not registered" 抛错
 * → 记忆批量写入失败风暴（梦境知识文件回写触发，曾致 Event Loop 阻塞 + 进程被强杀）。
 *
 * 修复：传对象 `{ content }` 绕过 parse 副作用，正文原样保留。
 */

import { describe, test, expect } from 'bun:test';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryStoreImpl } from '../MemoryStore.js';
import { createMemoryMetadata } from '../../types/MemoryMetadata.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitForFile(file: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!existsSync(file) && Date.now() < deadline) await sleep(50);
  expect(existsSync(file)).toBe(true);
}

function makeStore(): { dir: string; store: MemoryStoreImpl } {
  const dir = mkdtempSync(join(tmpdir(), 'memory-store-flush-'));
  const store = new MemoryStoreImpl(dir, ':memory:');
  return { dir, store };
}

describe('MemoryStore.flushBatch（预存错误 #57-1 修复回归）', () => {
  test('content 首行 ---page-break--- 不再导致批量写入失败', async () => {
    const { dir, store } = makeStore();
    try {
      const content = '---page-break---\n# 第十章：新的开始\n正文内容';
      await store.saveMemory({
        id: 'm-pagebreak',
        content,
        metadata: createMemoryMetadata({
          name: '章节',
          type: 'decision',
          sessionId: 'sess-x',
        }),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // 等待 1s debounce + 写入完成
      const file = join(dir, 'sessions', 'sess-x', 'm-pagebreak.md');
      await waitForFile(file);

      const written = readFileSync(file, 'utf-8');
      // 正文原样保留（含分页符标记），frontmatter 正常序列化
      expect(written).toContain('---page-break---');
      expect(written).toContain('正文内容');
      expect(written).toContain('name: 章节');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('普通 content 正常写入（无回归）', async () => {
    const { dir, store } = makeStore();
    try {
      await store.saveMemory({
        id: 'm-normal',
        content: '普通记忆正文',
        metadata: createMemoryMetadata({ name: '普通', type: 'user' }),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const file = join(dir, 'global', 'm-normal.md');
      await waitForFile(file);
      expect(readFileSync(file, 'utf-8')).toContain('普通记忆正文');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
