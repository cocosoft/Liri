/**
 * grep 单条匹配行长度闸（2026-10-31，上下文溢出预防第三步）
 *
 * 压缩成单行的文件（minified JS / 单行 JSON）被 grep 命中时，**一行**可达数 MB
 * （≈上百万 tokens）⇒ 单条结果即可把请求推过模型窗口（同日 155 次溢出 400）。
 * 口径：超长行按**命中位置**取 2k 字符窗口（前留 500），两侧标注省略量。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GrepTool } from '../../../src/tools/GrepTool/GrepTool';
import type { ToolUseContext } from '../../../src/tools/types/ToolUseContext';

const dir = mkdtempSync(join(tmpdir(), 'grep-line-cap-'));
const ctx = { options: { cwd: dir } } as unknown as ToolUseContext;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('grep 单条匹配行长度闸', () => {
  it('超长单行：以命中位置取窗口，仍能看到命中片段并标注截断', async () => {
    const needle = 'NEEDLE_GREP_LINE_CAP';
    const oneLine = 'a'.repeat(50_000) + needle + 'b'.repeat(50_000);
    writeFileSync(join(dir, 'bundle.min.js'), oneLine, 'utf-8');

    const r = await new GrepTool().execute(
      {
        pattern: needle,
        searchPath: dir,
        include: 'bundle.min.js',
        outputMode: 'content',
      },
      ctx
    );

    expect(r.success).toBe(true);
    const matches = (r.data as { matches: string[] }).matches;
    expect(matches).toHaveLength(1);

    const line = matches[0];
    expect(line).toContain(needle); // 命中片段必须在窗口内（不是简单截头）
    expect(line).toContain('已截断');
    expect(line).toContain('字符已省略');
    // 2k 窗口 + 两侧标注 ≤ 2.2k
    expect(line.length).toBeLessThan(2_300);
  });

  it('普通短行不受影响（回归）', async () => {
    writeFileSync(
      join(dir, 'short.txt'),
      'hello NEEDLE_SHORT world\n',
      'utf-8'
    );

    const r = await new GrepTool().execute(
      {
        pattern: 'NEEDLE_SHORT',
        searchPath: dir,
        include: 'short.txt',
        outputMode: 'content',
      },
      ctx
    );

    const matches = (r.data as { matches: string[] }).matches;
    expect(matches[0]).toContain('hello NEEDLE_SHORT world');
    expect(matches[0]).not.toContain('已截断');
  });
});
