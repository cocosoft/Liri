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
 * 用户工作流模板**执行入口**（P0-2(a)，2026-10-08）
 *
 * 规格：`.trae/specs/workflow-template-execution-binding.md` §7 **P0-2 选项 (a)** ——
 * 新增 HTTP 端点 `POST /v1/workflows/templates/:id/run`（经 service→端口→app）。
 *
 * **为何选 (a)**（另两选项被硬约束排除，非偏好）：
 * - (b) 扩 `office:workflow` 参数 `enum`：该 enum 在**工具创建时**由 doc 域的
 *   `DocOrchestrator.getAvailableWorkflows()` 静态生成，而用户模板是**运行期 CRUD** 的
 *   ⇒ 动态模板进不了该 enum；且该工具语义专属 doc 办公编排（描述/别名均如此）⇒ 耦合错位。
 * - (c) 以 skill 暴露：技能按规范**仅提示词注入**（`SkillTool` 无执行分支，见
 *   `project_rules §1.15-6`）⇒ **不能**承载"执行工作流"。
 *
 * 本模块**纯逻辑 + 依赖注入**（`getTemplate` / `execute` 由调用方注入）⇒ 可单测，
 * 且不把 store / seam 拖进模块顶层。
 */
import type { WorkflowRunResult } from '@modules/workflow';

import type { WorkflowTemplate } from './types';
import { templateToDefinition } from './workflowTemplateAssembly';

/**
 * 执行结果（**四态**，供 HTTP 层直接映射状态码；避免用错误文案做判定 —— CS02）。
 */
export type WorkflowTemplateRunOutcome =
  | { kind: 'not-found' }
  /** 模板存在但**结构上不可执行**（未全部显式声明 `tool`） */
  | { kind: 'not-executable'; reason: string }
  | { kind: 'completed'; completedSteps: string[]; value?: unknown }
  /** 未完成：`error` = 权限策略拒绝 / 步骤失败；`cancelled` = 步骤边界中止 */
  | {
      kind: 'failed';
      stopReason: 'error' | 'cancelled';
      completedSteps: string[];
      error: string;
    };

/** 执行入口依赖（注入 ⇒ 可单测） */
export interface WorkflowTemplateRunnerDeps {
  /** 取模板（内建 4 模板**不在** store，由调用方决定是否同时看内建） */
  getTemplate(templateId: string): Promise<WorkflowTemplate | null>;
  /** 执行 seam 工作流（按名查找；本模块只关心结果） */
  execute(
    workflowName: string,
    params: Record<string, unknown>
  ): Promise<WorkflowRunResult>;
}

/**
 * 执行一个用户模板：取模板 → 装配 → 交 seam 执行 → 归一为四态结果。
 *
 * 不含权限策略：策略在 **seam 侧 Provider 的执行预检**里（唯一收口 ⇒ 任何入口都受约束）。
 */
export async function runWorkflowTemplate(
  templateId: string,
  params: Record<string, unknown>,
  deps: WorkflowTemplateRunnerDeps
): Promise<WorkflowTemplateRunOutcome> {
  const template = await deps.getTemplate(templateId);
  if (!template) return { kind: 'not-found' };

  const definition = templateToDefinition(template);
  if (!definition) {
    return {
      kind: 'not-executable',
      reason:
        '模板步骤未全部显式声明 `tool`（缺省即为不可执行，不派生、不降级）',
    };
  }

  const result = await deps.execute(definition.name, params);
  if (result.stopReason === 'completed') {
    return {
      kind: 'completed',
      completedSteps: result.completedSteps,
      ...(result.value === undefined ? {} : { value: result.value }),
    };
  }
  return {
    kind: 'failed',
    stopReason: result.stopReason,
    completedSteps: result.completedSteps,
    error: result.error ?? `工作流 ${definition.name} 执行失败`,
  };
}
