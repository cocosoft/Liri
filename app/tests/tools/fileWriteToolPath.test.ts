// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `FileWriteTool` 回执路径单测（2026-10-17）
 *
 * 真机事故：模型用相对文件名写入，工具只回显 `input.file_path`（相对）⇒ 模型以为落在
 * `~/.pyapp/output`，在正文里写该路径；文件实际在会话工作目录 ⇒ 出站文件路由取不到，
 * 用户什么也收不到。修法：**只解析一次**，写盘与回执共用同一个绝对路径。
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileWriteTool } from '../../src/tools/FileWriteTool/FileWriteTool';

let dir = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'liri-fwt-'));
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('FileWriteTool：回执给出**实际写入的绝对路径**', () => {
  it('相对文件名（会话 cwd）⇒ 回执含 cwd 下的绝对路径，且文件真写在那里', async () => {
    const tool = new FileWriteTool();
    const res = await tool.execute({ file_path: 'a.md', content: 'hi' }, {
      options: { cwd: dir },
    } as never);

    expect(String(res.data)).toContain(join(dir, 'a.md'));
    expect(readFileSync(join(dir, 'a.md'), 'utf8')).toBe('hi');
  });
});

/**
 * BUG-D（2026-10-27 真机长程任务）：写入**新建子目录**的文件必须成功。
 *
 * 事故：`mkdir` 被复合只读安全闸 fail-closed 拒绝，而 `file_write` 的写前检查要求父目录
 * **已存在**（且用的是未解析的相对路径）⇒ `写入目录不存在`，模型无路可走。
 * 根因：写前检查与 `writeFile` 的「递归建目录」语义不一致。
 */
describe('BUG-D：file_write 写入新建子目录', () => {
  it('两层新目录 ⇒ 成功（写前只校验最近已存在的祖先）', async () => {
    const tool = new FileWriteTool();
    const res = await tool.execute(
      { file_path: 'js/core/game.js', content: 'console.log(1)' },
      { options: { cwd: dir } } as never
    );

    expect(res.success).not.toBe(false);
    expect(String(res.data)).toContain(join(dir, 'js', 'core', 'game.js'));
    expect(readFileSync(join(dir, 'js', 'core', 'game.js'), 'utf8')).toBe(
      'console.log(1)'
    );
  });

  it('负向对照：路径中某段是**文件** ⇒ 明确报错（不静默失败）', async () => {
    const tool = new FileWriteTool();
    await tool.execute({ file_path: 'blocker.txt', content: 'x' }, {
      options: { cwd: dir },
    } as never);
    const res = await tool.execute(
      { file_path: 'blocker.txt/sub/y.txt', content: 'x' },
      { options: { cwd: dir } } as never
    );

    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('是文件而非目录');
  });
});
