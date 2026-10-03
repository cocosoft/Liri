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
 * P1-3 方案 3（2026-09-26）：`DocWorkflowProvider` 经 seam 执行时的**进度发射**。
 *
 * 为什么必须有本用例：`DocPipelineParams.onProgress` 是本次新增参数，Provider 内
 * 的发射逻辑是"**新增但无消费者验证**"的典型风险点（编译通过 ≠ 事件序列正确）。
 * 本用例直接驱动 Provider（不经过工具/seam 单例），断言：
 *  - 阶段序列（outline → filling → compose 各自的 in_progress/completed）
 *  - **保真度**：filling 阶段带**节点清单**与**逐节点百分比**（与收口前 `runDocWorkflow` 同等）
 *  - 终态产出路径落在最后一个快照（前端据此显示"已生成"）
 */
import { describe, it, expect } from 'bun:test';
import {
  DocWorkflowProvider,
  DOC_PIPELINE_WORKFLOW,
} from '../../../src/modules/doc/workflow/DocWorkflowProvider';
import type { DocWorkflowProgressData } from '../../../src/modules/doc/types/outline';

function buildParams(onProgress: (d: DocWorkflowProgressData) => void) {
  return {
    input: { topic: '季度总结', format: 'docx' as const },
    llmNodes: [
      {
        id: 'n1',
        kind: 'section' as const,
        title: '背景',
        content: '背景正文',
      },
      {
        id: 'n2',
        kind: 'section' as const,
        title: '结论',
        content: '结论正文',
      },
    ],
    fillNode: async (node: { content?: string }) => node.content ?? '',
    generateImage: async () => '/tmp/img.png',
    generateDoc: async ({
      format,
    }: {
      title: string;
      content: string;
      format: string;
    }) => ({ filePath: '/tmp/out.docx', format }),
    onProgress,
  };
}

describe('DocWorkflowProvider · 方案 3 进度发射（seam 路径）', () => {
  it('阶段序列完整、filling 带节点清单与逐节点百分比、终态含产出路径', async () => {
    const provider = new DocWorkflowProvider();
    const definition = provider
      .listWorkflows()
      .find((w) => w.name === DOC_PIPELINE_WORKFLOW);
    expect(definition).toBeDefined();

    const snapshots: DocWorkflowProgressData[] = [];
    const result = await provider.execute(
      definition!,
      buildParams((d) => snapshots.push(d)) as unknown as Record<
        string,
        unknown
      >
    );

    // 运行成功 + 产出路径（seam 的 value = ComposeResult）
    expect(result.stopReason).toBe('completed');
    expect(String((result.value as { filePath?: string })?.filePath)).toBe(
      '/tmp/out.docx'
    );

    // 阶段序列：三阶段各自的 in_progress / completed 均出现
    const marks = snapshots.map(
      (s) => `${s.currentStage}:${s.stages[s.currentStage].status}`
    );
    for (const expected of [
      'outline:in_progress',
      'outline:completed',
      'filling:in_progress',
      'filling:completed',
      'compose:in_progress',
      'compose:completed',
    ]) {
      expect(marks).toContain(expected);
    }

    // 保真度①：filling 阶段有节点清单（2 个，title 与来源一致）
    const withNodes = snapshots.find(
      (s) => (s.stages.filling.nodes?.length ?? 0) > 0
    );
    expect(withNodes?.stages.filling.nodes?.map((n) => n.title)).toEqual([
      '背景',
      '结论',
    ]);

    // 保真度②：逐节点百分比（2 节点 ⇒ 出现 50 与 100）
    const percents = snapshots
      .map((s) => s.stages.filling.progress)
      .filter((p): p is number => typeof p === 'number');
    expect(percents).toContain(50);
    expect(percents).toContain(100);

    // 终态：产出路径落在最后一个快照（前端据此显示"已生成"）
    expect(snapshots[snapshots.length - 1].outputFilePath).toBe(
      '/tmp/out.docx'
    );
  });

  it('缺必需参数 ⇒ 抛 DOC_PIPELINE_PARAMS_MISSING（不静默降级）', async () => {
    const provider = new DocWorkflowProvider();
    const definition = provider.listWorkflows()[0];
    await expect(
      provider.execute(definition, { input: { topic: 'x', format: 'docx' } })
    ).rejects.toMatchObject({ code: 'DOC_PIPELINE_PARAMS_MISSING' });
  });
});
