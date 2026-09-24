/**
 * P0-1 接入点第一刀 端到端用例：doc 流水线经 workflow seam 执行。
 *
 * 覆盖（`.trae/specs/graph-engineering-p0.md` §七）：
 * 1. 拓扑序：四阶段按依赖序执行（空跑无并发，顺序可断言）；
 * 2. 成员级账本：每个阶段恰好一次 start/end，全部 `completed`；
 * 3. **P0-2 归因**：成稿阶段失败 ⇒ `failedStep='compose'` 且上游候选 = [images, fill_content, outline]；
 * 4. 边界：参数缺失 ⇒ 抛 `DOC_PIPELINE_PARAMS_MISSING`（不静默降级）。
 */

import { describe, it, expect } from 'bun:test';

import { WorkflowEngine } from '../../../src/modules/workflow/index.js';
import type {
  WorkflowRunEndInfo,
  WorkflowRunObserver,
  WorkflowStepEndInfo,
} from '../../../src/modules/workflow/index.js';
import {
  DOC_PROVIDER_ID,
  DOC_PIPELINE_WORKFLOW,
  DocWorkflowProvider,
} from '../../../src/modules/doc/workflow/DocWorkflowProvider.js';

/** 组装一份最小合法 params（docx 格式避开 PPT 精炼规则，聚焦接线本身） */
function params(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    input: { topic: '测试主题', format: 'docx' },
    llmNodes: [
      { id: 'sec-1', kind: 'section', title: '第一章' },
      { id: 'sec-2', kind: 'section', title: '第二章' },
    ],
    fillNode: async () => '正文内容',
    generateImage: async () => '/tmp/img.png',
    generateDoc: async () => ({ filePath: '/tmp/out.docx', format: 'docx' }),
    ...overrides,
  };
}

function engineWithDocProvider(): WorkflowEngine {
  const engine = new WorkflowEngine();
  engine.registerProvider(new DocWorkflowProvider());
  return engine;
}

interface Capture {
  end?: WorkflowRunEndInfo;
  stepStarts: string[];
  stepEnds: WorkflowStepEndInfo[];
}

async function run(
  engine: WorkflowEngine,
  p: Record<string, unknown>
): Promise<Capture> {
  const capture: Capture = { stepStarts: [], stepEnds: [] };
  const observer: WorkflowRunObserver = {
    onStepStart: (info) => capture.stepStarts.push(info.stepId),
    onStepEnd: (info) => capture.stepEnds.push(info),
    onRunEnd: (info) => {
      capture.end = info;
    },
  };
  await engine.execute(DOC_PIPELINE_WORKFLOW, p, { observer });
  return capture;
}

describe('doc 流水线接入 seam（第一刀）', () => {
  it('四阶段按拓扑序执行，成员级账本每阶段恰好一次 start/end 且全部完成', async () => {
    const capture = await run(engineWithDocProvider(), params());

    expect(capture.end?.stopReason).toBe('completed');
    expect(capture.stepStarts).toEqual([
      'outline',
      'fill_content',
      'images',
      'compose',
    ]);
    expect(capture.stepEnds.map((e) => [e.stepId, e.outcome])).toEqual([
      ['outline', 'completed'],
      ['fill_content', 'completed'],
      ['images', 'completed'],
      ['compose', 'completed'],
    ]);
    // 成功路径不下发归因字段
    expect(capture.end?.rootCauseCandidates).toBeUndefined();
  });

  it('成稿失败 ⇒ 定位到 compose，且根因候选为上游三阶段（P0-2 端到端）', async () => {
    const capture = await run(
      engineWithDocProvider(),
      params({
        generateDoc: async () => {
          throw new Error('磁盘写入失败');
        },
      })
    );

    expect(capture.end?.stopReason).toBe('error');
    expect(capture.end?.failedStep).toBe('compose');
    expect(capture.end?.completedSteps).toEqual([
      'outline',
      'fill_content',
      'images',
    ]);
    expect(capture.end?.rootCauseCandidates?.map((c) => c.nodeId)).toEqual([
      'images',
      'fill_content',
      'outline',
    ]);
    // 证据指回本 run 的具体步骤，可独立复核
    expect(capture.end?.rootCauseCandidates?.[0].pathEvidenceRefs[0]).toMatch(
      /^run:wf_\d+_\d+#step:images$/
    );
  });

  it('配图失败被降级（不中断流水线）：images 步仍记为 completed，成稿照常完成', async () => {
    // 依据：填充阶段产物 `FilledOutline` 自带 `failedNodes`/`imageCache` ⇒ 配图失败走降级而非抛错
    const capture = await run(
      engineWithDocProvider(),
      params({
        generateImage: async () => {
          throw new Error('生图服务不可用');
        },
      })
    );
    expect(capture.end?.stopReason).toBe('completed');
    expect(capture.stepEnds.map((e) => [e.stepId, e.outcome])).toContainEqual([
      'images',
      'completed',
    ]);
  });

  it('用户取消大纲 ⇒ 报失败且不标记 outline 完成', async () => {
    const capture = await run(
      engineWithDocProvider(),
      params({ confirmOutline: async () => false })
    );
    expect(capture.end?.stopReason).toBe('error');
    expect(capture.end?.completedSteps).toEqual([]);
    expect(capture.stepEnds.map((e) => e.outcome)).toEqual(['failed']);
  });

  it('缺少必需参数 ⇒ 抛 DOC_PIPELINE_PARAMS_MISSING（不静默降级）', async () => {
    const engine = engineWithDocProvider();
    let code = '(no-throw)';
    try {
      await engine.execute(DOC_PIPELINE_WORKFLOW, { input: { topic: 'x', format: 'docx' } });
    } catch (e) {
      code = String((e as { code?: string }).code);
    }
    expect(code).toBe('DOC_PIPELINE_PARAMS_MISSING');
  });

  it('Provider 自述：providerId 与工作流名固定，步骤依赖成链', () => {
    const provider = new DocWorkflowProvider();
    expect(provider.providerId).toBe(DOC_PROVIDER_ID);
    const definition = provider.listWorkflows()[0];
    expect(definition.name).toBe(DOC_PIPELINE_WORKFLOW);
    expect(definition.steps.map((s) => s.dependsOn ?? [])).toEqual([
      [],
      ['outline'],
      ['fill_content'],
      ['images'],
    ]);
  });
});
