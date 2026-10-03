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
 * P1-3（2026-09-26，方案 1）：`office:doc-pipeline` 工具的参数校验与元信息。
 *
 * 覆盖范围（如实）：
 * - ✅ 元信息（名称/别名/参数表/`interruptBehavior`）—— 防后续被改坏（`grep` 不出现在任何其它测试）
 * - ✅ **全部校验分支**：这些分支在触达任何工具**之前**即返回 ⇒ 用例完全 hermetic（无需桩、无全局状态）
 * - ⚠️ **未覆盖（本条如实标注，非遗漏）**：① 委派（`image_generate`/`doc_generate`）需要桩替换全局
 *   工具表；② 进度落盘（`onProgress` → `ChatManager.persistDocWorkflowProgress`）需要 ChatManager
 *   运行环境（真实 DB/事件日志）。二者属端到端范畴，待集成测试补齐。
 */
import { describe, it, expect } from 'bun:test';
import { DocModule } from '../../../src/modules/doc/DocModule';
import { ToolExecutionStatus } from '../../../src/tools/types/ToolResult';
import type { Tool, ToolUseContext } from '../../../src/tools/types/Tool';

/**
 * 取私有工厂产出的工具。
 * TS 的 `private` 仅编译期约束 ⇒ 用**窄化 cast**（非 `any`，符合「新代码零 any」）访问真实代码路径。
 */
function makePipelineTool(): Tool {
  const docModule = new DocModule();
  return (
    docModule as unknown as { createPipelineTool(): Tool }
  ).createPipelineTool();
}

/** 最小上下文：校验分支在触达任何工具前返回，故仅 `sessionId` 有意义 */
const ctx = {
  sessionId: 'session_test_doc_pipeline',
} as unknown as ToolUseContext;

function baseInput(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    topic: '季度技术总结',
    format: 'docx',
    nodes: [{ title: '背景', content: '正文内容' }],
    ...overrides,
  };
}

describe('office:doc-pipeline · 元信息', () => {
  it('名称 / 别名 / 参数表 / interruptBehavior 齐备', () => {
    const tool = makePipelineTool();
    expect(tool.name).toBe('office:doc-pipeline');
    expect(tool.aliases).toContain('doc_pipeline');
    expect(tool.params.map((p) => p.name)).toEqual([
      'topic',
      'format',
      'nodes',
      'fillConcurrency',
      'imageConcurrency',
    ]);
    // ToolInfo.interruptBehavior 为**必填**（tools/types/Tool.ts:86）——曾因漏写而编译失败，故锁定
    expect(tool.getInfo().interruptBehavior).toBe('block');
  });
});

describe('office:doc-pipeline · 参数校验（不进入流水线即返回）', () => {
  it('topic 为空 ⇒ FAILURE', async () => {
    const res = await makePipelineTool().execute(
      baseInput({ topic: '   ' }),
      ctx
    );
    expect(res.status).toBe(ToolExecutionStatus.FAILURE);
    expect(String(res.errorOutput)).toContain('topic 不能为空');
  });

  it('format=pdf ⇒ 显式拒绝（底层 doc_generate 取值域无 pdf，不得静默错映射）', async () => {
    const res = await makePipelineTool().execute(
      baseInput({ format: 'pdf' }),
      ctx
    );
    expect(res.status).toBe(ToolExecutionStatus.FAILURE);
    expect(String(res.errorOutput)).toContain('暂不支持 format=pdf');
  });

  it('format 非法值 ⇒ 明确报错并列出可选值', async () => {
    const res = await makePipelineTool().execute(
      baseInput({ format: 'xlsx' }),
      ctx
    );
    expect(res.status).toBe(ToolExecutionStatus.FAILURE);
    expect(String(res.errorOutput)).toContain('format 非法');
    expect(String(res.errorOutput)).toContain('docx/pptx/html');
  });

  it('nodes 为空 ⇒ FAILURE', async () => {
    const res = await makePipelineTool().execute(baseInput({ nodes: [] }), ctx);
    expect(res.status).toBe(ToolExecutionStatus.FAILURE);
    expect(String(res.errorOutput)).toContain('nodes 不能为空');
  });

  it('node 缺 title ⇒ 精确指出下标', async () => {
    const res = await makePipelineTool().execute(
      baseInput({ nodes: [{ content: 'x' }] }),
      ctx
    );
    expect(res.status).toBe(ToolExecutionStatus.FAILURE);
    expect(String(res.errorOutput)).toContain('nodes[0].title 不能为空');
  });

  it('node 既无 content 也无 bullets ⇒ 报错（LLM 工作须由模型随参数给出）', async () => {
    const res = await makePipelineTool().execute(
      baseInput({ nodes: [{ title: '章节' }] }),
      ctx
    );
    expect(res.status).toBe(ToolExecutionStatus.FAILURE);
    expect(String(res.errorOutput)).toContain('需提供 content 或非空 bullets');
  });

  it('允许 bullets 代替 content（PPT 式要点）', async () => {
    const res = await makePipelineTool().execute(
      baseInput({ nodes: [{ title: '要点', bullets: ['一', '二'] }] }),
      ctx
    );
    // 校验通过 ⇒ 不会因参数被拒；后续会因 image_generate/doc_generate 未注册而失败（非校验失败）
    expect(String(res.errorOutput ?? '')).not.toContain(
      '需提供 content 或非空 bullets'
    );
  });
});
