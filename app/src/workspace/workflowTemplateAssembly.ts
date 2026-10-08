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
 * 模板 → 可执行定义 **装配层**（P1-19 ②，2026-10-08）
 *
 * 规格：`.trae/specs/workflow-template-execution-binding.md`（推荐形态 ①+②）。
 * 纯函数、零副作用：模板族（"清单"，`WorkflowTemplate`）→ 定义族（"可执行"，`WorkflowDefinition`）。
 *
 * **两条硬约束**：
 * 1. **不猜、不降级**（CS04）：`tool` 只能**显式声明** —— `type`（人机交互模式）、
 *    `suggestedAgentRole`（角色≠工具）、`description`（自然语言，CS02 禁字符串判定）
 *    均**不可**派生工具名 ⇒ **任一步骤缺 `tool`，整模板即不可执行**（返回 `null`）。
 * 2. **定义名加来源前缀** `template:`（spec §5.2）：`WorkflowEngine.find()` 按名**首个命中**
 *    跨 Provider 查找 ⇒ 不加前缀会与 seam 既有工作流名（`send-report` / `doc_pipeline` …）撞名。
 *
 * **不重写拓扑逻辑**（CS01）：`dependsOn` 原样透传，交由 `WorkflowEngine.validate()` /
 * `orderSteps()` 做静态校验 + 拓扑排序。
 */
import type { WorkflowTemplate, WorkflowStep } from './types';
import type { WorkflowDefinition, WorkflowStepSpec } from '@modules/workflow';

/** 可执行定义名的**来源前缀**（防与 seam 既有工作流名撞名） */
export const TEMPLATE_WORKFLOW_PREFIX = 'template:';

/** 由模板 id 派生可执行定义名 */
export function templateWorkflowName(templateId: string): string {
  return `${TEMPLATE_WORKFLOW_PREFIX}${templateId}`;
}

/** 带**已确认非空** `tool` 的步骤（类型谓词，供下方收窄，避免非空断言） */
type StepWithTool = WorkflowStep & { tool: string };

/** 该步骤是否显式声明了工具名（非空字符串） */
function hasTool(step: WorkflowStep): step is StepWithTool {
  return typeof step.tool === 'string' && step.tool.trim().length > 0;
}

/**
 * 装配：`WorkflowTemplate` → `WorkflowDefinition`。
 *
 * **仅当每个步骤都显式带 `tool` 且步骤非空**时产出定义；否则返回 `null`
 * （该模板**不可执行** —— 显式不可执行，不静默降级）。
 */
export function templateToDefinition(
  template: WorkflowTemplate
): WorkflowDefinition | null {
  const steps: WorkflowStepSpec[] = [];
  for (const step of template.steps ?? []) {
    if (!hasTool(step)) return null;
    steps.push({
      id: step.id,
      // 描述缺省时回退步骤名（seam 的 `description` 必填，用于日志/进度展示）
      description: step.description || step.name,
      tool: step.tool,
      ...(step.dependsOn && step.dependsOn.length > 0
        ? { dependsOn: [...step.dependsOn] }
        : {}),
    });
  }
  if (steps.length === 0) return null;

  return {
    name: templateWorkflowName(template.id),
    description: template.description || template.name,
    steps,
  };
}
