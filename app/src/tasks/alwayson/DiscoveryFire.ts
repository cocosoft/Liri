/**
 * DiscoveryFire — 4 阶段流水线执行器
 *
 * P0-2: Discovery → Workspace → Execution → Report
 */
import type { DiscoveryPlan, ExecutionResult, AlwaysOnConfig } from './types';
import type { DiscoveryGates } from './DiscoveryGates';
import { cg3Log } from '../cg3Env';

export class DiscoveryFire {
  private config: AlwaysOnConfig['execution'];

  constructor(config: AlwaysOnConfig['execution']) {
    this.config = config;
  }

  /** 阶段 1: Discovery — Agent 分析项目状态（由 AlwaysOnRuntime 注入 ChatManager 调用） */
  async discovery(): Promise<DiscoveryPlan | null> {
    cg3Log('tasks:alwayson:fire', 'debug', 'discovery:start');
    // 实际实现：调 ChatManager.sendMessage() 发送 discovery prompt
    // 此处在 AlwaysOnRuntime 中被覆盖为具体实现
    return null;
  }

  /** 阶段 2: Workspace — 在 git worktree 中准备隔离环境（由 AlwaysOnRuntime 注入具体实现） */
  async workspace(_plan: DiscoveryPlan): Promise<string> {
    return '';
  }

  /** 阶段 3: Execution — bypassPermissions 自动执行（由 AlwaysOnRuntime 注入发现计划的具体步骤） */
  async execution(_workspace: string): Promise<ExecutionResult> {
    return {
      success: true,
      output: '',
      errors: [],
      toolCalls: 0,
      durationMs: 0,
    };
  }

  /** 阶段 4: Report — 生成 Markdown 报告 */
  async report(result: ExecutionResult): Promise<string> {
    const lines = [
      '# AlwaysOn Execution Report',
      '',
      `- **Success**: ${result.success}`,
      `- **Duration**: ${result.durationMs}ms`,
      `- **Tool Calls**: ${result.toolCalls}`,
    ];
    if (result.errors.length > 0) {
      lines.push('', '## Errors');
      for (const e of result.errors) lines.push(`- ${e}`);
    }
    if (result.output) {
      lines.push('', '## Output', '', '```', result.output, '```');
    }
    return lines.join('\n');
  }
}
