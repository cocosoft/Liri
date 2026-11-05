/**
 * file_edit 失败语义（2026-11-05，真机 `app.log` 复盘）
 *
 * 事故：`old_string` 未命中时工具仍回报 "Successfully edited file"，模型以为写成功
 * ⇒ 对同一处反复 edit、零进展；`replace_all` 分支无命中还把原内容原样写回并报 `replaced:true`。
 *
 * 本片锁住三条契约：
 *  ① 未命中（含 replace_all 0 命中）⇒ `success:false`，并提示先读文件 / 改用 file_write；
 *  ② 同一处连续未命中第 2 次 ⇒ 文案升级为「禁止原样重试」；
 *  ③ 单次 old_string/new_string 超过 4KB ⇒ 提前拒绝（真机 5088 字符 JSON 被输出上限截断）。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileEditTool } from '../../src/tools/FileEditTool/FileEditTool';
import type { ToolUseContext } from '../../src/tools/types/ToolUseContext';

const dir = mkdtempSync(join(tmpdir(), 'file-edit-no-match-'));
const ctx = {
  sessionId: 'test-session',
  options: { cwd: dir },
} as unknown as ToolUseContext;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 每个用例独立文件名，避免同处未命中计数串味 */
let seq = 0;
function seed(content: string): string {
  seq += 1;
  const name = `case-${seq}.md`;
  writeFileSync(join(dir, name), content, 'utf-8');
  return name;
}

describe('file_edit：未命中必须硬失败', () => {
  it('old_string 未命中 ⇒ success:false，且文件保持不变', async () => {
    const name = seed('# 标题\n\n原始内容\n');
    const result = await new FileEditTool().execute(
      { file_path: name, old_string: '不存在的片段', new_string: '新内容' },
      ctx
    );
    expect(result.success).toBe(false);
    expect(String(result.data)).toContain('未命中');
    expect(readFileSync(join(dir, name), 'utf-8')).toBe('# 标题\n\n原始内容\n');
  });

  it('replace_all 0 命中 ⇒ success:false（不再假报 replaced:true）', async () => {
    const name = seed('alpha\n');
    const result = await new FileEditTool().execute(
      {
        file_path: name,
        old_string: 'beta',
        new_string: 'gamma',
        replace_all: true,
      },
      ctx
    );
    expect(result.success).toBe(false);
    expect(String(result.data)).toContain('未命中');
    expect(readFileSync(join(dir, name), 'utf-8')).toBe('alpha\n');
  });

  it('同一处连续未命中第 2 次 ⇒ 提示「禁止原样重试」', async () => {
    const name = seed('same\n');
    const tool = new FileEditTool();
    const args = {
      file_path: name,
      old_string: 'missing',
      new_string: 'x',
    };
    const first = await tool.execute(args, ctx);
    expect(first.success).toBe(false);
    expect(String(first.data)).not.toContain('禁止原样重试');

    const second = await tool.execute(args, ctx);
    expect(second.success).toBe(false);
    expect(String(second.data)).toContain('禁止原样重试');
  });

  it('命中后可正常替换（成功后清除未命中计数）', async () => {
    const name = seed('old line\n');
    const tool = new FileEditTool();
    const miss = await tool.execute(
      { file_path: name, old_string: 'absent', new_string: 'x' },
      ctx
    );
    expect(miss.success).toBe(false);

    const ok = await tool.execute(
      { file_path: name, old_string: 'old line', new_string: 'new line' },
      ctx
    );
    expect(ok.success).not.toBe(false);
    expect(readFileSync(join(dir, name), 'utf-8')).toBe('new line\n');
  });
});

describe('file_edit：大参数护栏（4KB）', () => {
  it('old_string 超限 ⇒ 提前拒绝并建议 file_write / 拆小', async () => {
    const name = seed('x\n');
    const result = await new FileEditTool().execute(
      {
        file_path: name,
        old_string: 'a'.repeat(4 * 1024 + 1),
        new_string: 'b',
      },
      ctx
    );
    expect(result.success).toBe(false);
    const text = String(result.data);
    expect(text).toContain('编辑参数过大');
    expect(text).toContain('file_write');
  });

  it('new_string 超限同样拒绝', async () => {
    const name = seed('x\n');
    const result = await new FileEditTool().execute(
      {
        file_path: name,
        old_string: 'x',
        new_string: 'b'.repeat(4 * 1024 + 1),
      },
      ctx
    );
    expect(result.success).toBe(false);
    expect(String(result.data)).toContain('编辑参数过大');
  });
});
