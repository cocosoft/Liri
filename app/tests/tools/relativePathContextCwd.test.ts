/**
 * 工具相对路径必须相对**工具上下文 cwd** 解析（2026-10-31 真机 app.log 取证）
 *
 * 现象：LRO/PDCA 步骤的 `context.options.cwd` 是任务工作区
 * （`C:\Users\…\.pyapp\workspaces\<taskId>`，提示词也要求"路径一律相对工作区根"），
 * 但 `glob` / `grep` 的**显式相对路径入参**与 `file_read` 的**可访问性检查**
 * 都按 `process.cwd()`（代码仓根）解析 ⇒ 单窗口 100+ 次
 * `搜索目录不存在: E:\…\workspaces 里明明存在 output`，模型反复重试直至 IO 循环拦截。
 *
 * 口径：相对路径一律相对 `context.options.cwd`；未提供时保持旧行为（`process.cwd()`）。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GlobTool } from '../../src/tools/search/GlobTool';
import { GrepTool } from '../../src/tools/GrepTool/GrepTool';
import { FileReadTool } from '../../src/tools/FileReadTool/FileReadTool';
import type { ToolUseContext } from '../../src/tools/types/ToolUseContext';

const workspace = mkdtempSync(join(tmpdir(), 'tool-cwd-scope-'));
const outputDir = join(workspace, 'output');
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'note.md'), 'NEEDLE_CWD_SCOPE\n', 'utf-8');

const ctx = { options: { cwd: workspace } } as unknown as ToolUseContext;

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('工具相对路径解析：相对上下文 cwd（任务/会话工作区）', () => {
  it('glob: 相对 path 命中工作区内文件（不再报进程 cwd 下目录不存在）', async () => {
    const r = await new GlobTool().execute(
      { path: 'output', pattern: '**/*' },
      ctx
    );
    expect(r.success).toBe(true);
    const names = (r.data as string[]).map((f) => f.replace(/\\/g, '/'));
    expect(names.some((f) => f.endsWith('note.md'))).toBe(true);
  });

  it('grep: 相对 searchPath 命中工作区内内容', async () => {
    const r = await new GrepTool().execute(
      { searchPath: 'output', pattern: 'NEEDLE_CWD_SCOPE' },
      ctx
    );
    expect(r.success).toBe(true);
    expect((r.data as { matchCount: number }).matchCount).toBeGreaterThan(0);
  });

  it('file_read: 可访问性检查与读取使用同一已解析路径（不再误判文件不存在）', async () => {
    const r = await new FileReadTool().execute(
      { file_path: 'output/note.md' },
      ctx
    );
    expect(String(r.data)).toContain('NEEDLE_CWD_SCOPE');
  });

  it('glob: 相对路径确实不存在时，报错指向工作区路径（诊断不误导到代码仓根）', async () => {
    const r = await new GlobTool().execute(
      { path: 'missing_dir', pattern: '*.*' },
      ctx
    );
    expect(r.success).toBe(false);
    expect(String(r.error).toLowerCase()).toContain(workspace.toLowerCase());
  });
});
