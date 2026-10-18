/**
 * 工具策略管道
 *
 * 多阶段策略评估，按顺序执行多个策略；任一拒绝即拒绝，全部通过才允许。
 *
 * **空管道语义（A-3，2026-10-18）**：默认 **fail-closed** —— 没有任何阶段的管道
 * 拒绝所有工具（`denyResult`），避免「忘装配策略 ⇒ 静默全放行」。
 * 若确实需要 allow-all（如测试或显式灰度），必须构造时传 `{ allowEmpty: true }`。
 */

import type { Tool } from '../types/Tool';
import type { ToolPolicy, PolicyContext, PolicyResult } from './ToolPolicy';
import { allowResult, denyResult } from './ToolPolicy';

/** 空管道语义选项 */
export interface ToolPolicyPipelineOptions {
  /**
   * 空管道是否放行（默认 `false` ⇒ fail-closed）。
   * ⚠️ 仅用于显式 allow-all 场景；生产默认策略管道不得为空。
   */
  allowEmpty?: boolean;
}

export class ToolPolicyPipeline implements ToolPolicy {
  readonly name = 'ToolPolicyPipeline';
  private stages: ToolPolicy[] = [];
  private readonly allowEmpty: boolean;

  constructor(stages?: ToolPolicy[], options?: ToolPolicyPipelineOptions) {
    if (stages) {
      this.stages = [...stages];
    }
    this.allowEmpty = options?.allowEmpty ?? false;
  }

  /**
   * 添加策略阶段（追加到末尾）
   */
  addStage(policy: ToolPolicy): this {
    this.stages.push(policy);
    return this;
  }

  /**
   * 在指定位置插入策略阶段
   */
  insertStage(index: number, policy: ToolPolicy): this {
    this.stages.splice(index, 0, policy);
    return this;
  }

  /**
   * 移除指定策略阶段
   */
  removeStage(policyName: string): boolean {
    const index = this.stages.findIndex((s) => s.name === policyName);
    if (index >= 0) {
      this.stages.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * 获取当前策略阶段列表
   */
  getStages(): ReadonlyArray<ToolPolicy> {
    return [...this.stages];
  }

  /**
   * 清空所有策略阶段
   */
  clearStages(): this {
    this.stages = [];
    return this;
  }

  evaluate(tool: Tool, context: PolicyContext): PolicyResult {
    // A-3：空管道默认 fail-closed（忘装配策略不得静默全放行）
    if (this.stages.length === 0) {
      return this.allowEmpty
        ? allowResult(this.name)
        : denyResult(this.name, 'no policy stages (fail-closed)');
    }

    for (const stage of this.stages) {
      const result = stage.evaluate(tool, context);
      if (!result.allowed) {
        return denyResult(
          this.name,
          `策略 ${stage.name} 拒绝工具 ${tool.name}: ${result.reason}`
        );
      }
    }
    return allowResult(this.name);
  }

  evaluateBatch(tools: Tool[], context: PolicyContext): PolicyResult[] {
    // A-3：空管道批量求值同样 fail-closed
    if (this.stages.length === 0) {
      return tools.map(() =>
        this.allowEmpty
          ? allowResult(this.name)
          : denyResult(this.name, 'no policy stages (fail-closed)')
      );
    }

    const results: PolicyResult[] = [];

    for (const tool of tools) {
      let allowed = true;
      let lastDenyReason: string | undefined;

      for (const stage of this.stages) {
        const result = stage.evaluate(tool, context);
        if (!result.allowed) {
          allowed = false;
          lastDenyReason = `策略 ${stage.name} 拒绝: ${result.reason}`;
          break;
        }
      }

      results.push(
        allowed
          ? allowResult(this.name)
          : denyResult(this.name, lastDenyReason ?? '未知原因')
      );
    }

    return results;
  }
}
