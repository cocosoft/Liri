// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * W2/M1（2026-09-25）：项目类工具在「缺 projectId / 项目不存在」时必须
 * **可判定失败**（落 `error` 字段）且**自带出路**。
 *
 * 背景：实机观测模型在"找不到本项目"时**空转搜索工作区**（112 次工具调用 / 180s 未收敛），
 * 仅靠系统提示词只能改善、不能根除（台账 N-60）⇒ 改为工具层早失败 + 明确指引。
 * 读侧此前只写 `newMessages`、**不落 `error`** ⇒ 与 O1-3 修的写侧同型（失败不可判定），
 * 故以下用例均为「修复前必失败」。
 */
import { describe, it, expect } from 'bun:test';
import { ReadProjectFileTool } from '../../src/tools/ReadProjectFileTool/ReadProjectFileTool.js';
import type { ToolUseContext } from '../../src/tools/types/ToolUseContext.js';

const tool = ReadProjectFileTool.create();
const ctx = {} as ToolUseContext;

describe('read_project_file 失败可判定性 + 出路指引（W2/M1）', () => {
  it('缺少 projectId ⇒ error 落字段且含出路指引（修复前只有 newMessages）', async () => {
    const r = await tool.execute({ relativePath: 'a.md' }, ctx);
    // 修复前：r.error 为 undefined ⇒ 失败
    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.error).toContain('缺少 projectId');
    expect(r.error).toContain('向用户询问项目');
    expect(r.error).toContain('不要用 grep/glob/read 在工作区里搜寻项目');
  });

  it('项目不存在 ⇒ error 落字段、含项目 id 与出路指引', async () => {
    const r = await tool.execute(
      { projectId: 'proj_not_exist_xyz', relativePath: 'a.md' },
      ctx
    );
    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.error).toContain('不存在或已被删除');
    expect(r.error).toContain('proj_not_exist_xyz');
    expect(r.error).toContain('向用户询问项目');
  });
});
