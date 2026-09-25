/**
 * 一期 O1-3（2026-09-24「会话暴露问题分析与优化方案」§五）：
 * `write_project_file` 的失败必须**可判定** —— 此前全部失败路径都返回 `payload=null` + 只有
 * `newMessages` 文案，与"成功但空载荷"**不可区分**（会话实测中模型据此得到"返回空对象"，
 * 无法判断是否落盘成功，最终绕道 `file_write`），且违反「失败信息必须落 `error` 字段」约定。
 *
 * 每个用例均为「修复前必失败」。
 */

import { describe, it, expect } from 'bun:test';
import { WriteProjectFileTool } from '../../src/tools/WriteProjectFileTool/WriteProjectFileTool.js';
import type { ToolUseContext } from '../../src/tools/types/ToolUseContext.js';

const tool = WriteProjectFileTool.create();
const ctx = {} as ToolUseContext;

describe('write_project_file 失败可判定性（一期 O1-3）', () => {
  it('缺少 projectId/relativePath ⇒ 结果携带 error（修复前只有 newMessages）', async () => {
    const r = await tool.execute({ relativePath: 'a.md', content: 'hi' }, ctx);
    // 修复前：error 为 undefined（只有 newMessages 文案）⇒ 失败
    expect(r.error).toBeTruthy();
    expect(r.error).toContain('缺少 projectId');
    expect(r.success).toBe(false);
  });

  it('缺少 content/source_file ⇒ 结果携带 error', async () => {
    const r = await tool.execute(
      { projectId: 'proj_x', relativePath: 'a.md' },
      ctx
    );
    // 修复前：error 为 undefined ⇒ 失败
    expect(r.error).toBeTruthy();
    expect(r.error).toContain('缺少参数 content 或 source_file');
    expect(r.success).toBe(false);
  });

  it('成功与失败的载荷结构可区分（失败 != 安静的空载荷）', async () => {
    const failed = await tool.execute({}, ctx);
    // 修复前：失败载荷与"成功但空"同形（data=null 且无 error）⇒ 无法区分 ⇒ 失败
    expect(failed.data).toBeNull();
    expect(failed.error).toBeTruthy();
  });

  it('W2/Y：缺 projectId 时 error 必须给出可执行出路（禁瞎搜 + 禁生成类工具顶替）', async () => {
    const r = await tool.execute({ relativePath: 'a.md', content: 'hi' }, ctx);
    expect(r.error).toBeTruthy();
    // 实机观测：模型在"找不到本项目"时空转 180s / 112 次工具调用 ⇒ 必须明确禁止该路径
    expect(r.error).toContain('向用户询问项目');
    expect(r.error).toContain('不要用 grep/glob/read 在工作区里搜寻项目');
    // 并说明"顶替"的后果（产物不登记为「成果」）
    expect(r.error).toContain('不会登记为项目「成果」');
  });
});
