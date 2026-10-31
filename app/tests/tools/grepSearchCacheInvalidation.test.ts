/**
 * grep 重复短路缓存：**写入后必须失效**（2026-10-31）
 *
 * 背景：`GrepTool` 对同一搜索键有 60s 短路（防空转），命中时回**上次的真实结果**并置
 * `skipped: true`，正文还会提示"请基于上次结果直接交付／确需继续搜索请换 pattern"。
 * 但缓存**不随写入失效** ⇒「写前搜 0 命中 → 写文件 → 写后同 pattern 复查」会拿到
 * **写前的陈旧零命中**，模型据此误判"没写成功 / 内容不存在"。
 *
 * 口径：`file_write` / `file_edit` 成功后清空短路缓存（写入是"结果已改变"的确定信号）。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GrepTool } from '../../src/tools/GrepTool/GrepTool';
import { FileWriteTool } from '../../src/tools/FileWriteTool/FileWriteTool';
import type { ToolUseContext } from '../../src/tools/types/ToolUseContext';

const dir = mkdtempSync(join(tmpdir(), 'grep-cache-invalidation-'));
const ctx = { options: { cwd: dir } } as unknown as ToolUseContext;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('grep 重复短路缓存：写入后必须失效', () => {
  it('file_write 之后同 pattern 复查不再返回写前的陈旧结果', async () => {
    const grep = new GrepTool();
    const args = {
      pattern: 'NEEDLE_CACHE_INVALIDATE',
      searchPath: '.',
      outputMode: 'content',
    };

    const first = await grep.execute(args, ctx);
    expect((first.data as { matchCount: number }).matchCount).toBe(0);

    const written = await new FileWriteTool().execute(
      { file_path: 'note.txt', content: 'NEEDLE_CACHE_INVALIDATE\n' },
      ctx
    );
    expect(written.success).not.toBe(false);

    const second = await grep.execute(args, ctx);
    const data = second.data as { matchCount: number; skipped: boolean };
    expect(data.skipped).toBe(false);
    expect(data.matchCount).toBeGreaterThan(0);
  });
});
