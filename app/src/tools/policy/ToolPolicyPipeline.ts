/**
 * 工具策略管道
 * 多阶段策略评估，按顺序执行多个策略
 * 任一策略拒绝则拒绝，全部通过则允许
 */

import type { Tool } from '../types/Tool';
import type { ToolPolicy, PolicyContext, PolicyResult } from './ToolPolicy';
import { allowResult, denyResult } from './ToolPolicy';

export class ToolPolicyPipeline implements ToolPolicy {
  readonly name = 'ToolPolicyPipeline';
  private stages: ToolPolicy[] = [];

  constructor(stages?: ToolPolicy[]) {
    if (stages) {
      this.stages = [...stages];
    }
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
      this.stages.splice(index, 0);
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
