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
