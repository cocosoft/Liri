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
 * 保存前「规则影响预演」（R5，2026-11-17；治理方案 §11.6-④）
 *
 * 目的：写规则**之前**用一组**基准命令**跑一遍真实判定链，比较"写前 / 写后"的结论；
 * 若有基准从 `ask`/`allow` 变成 `deny`（例如新建一条工具级 deny），说明可能把自己或
 * agent 锁死 ⇒ 接口返回 409 + 影响清单，要求显式 `confirmImpact=true` 再写。
 *
 * 硬约束：
 * - **不写任何状态**：规则装在 `RuleManager.createInMemory()` 的沙箱实例里，复用
 *   `simulatePermissionDecision`（真实判定链），不触碰生产规则文件与命中计数；
 * - **不猜**：只对**命令类工具**（bash / powershell / pwsh）有基准清单，其余工具
 *   返回 `null`（没有基准就说没有，不编造"无影响"）。
 */
import type { PermissionBehavior } from '../types/PermissionRule';

/** 判定结论（与 `SimulatePermissionResult.decision` 同口径） */
export type RuleImpactDecision = 'allow' | 'ask' | 'deny';

/** 基准命令（3~5 条"agent 日常操作"，按工具方言分组） */
export const RULE_IMPACT_BASELINE: ReadonlyArray<{
  /** 规范工具名（bash / powershell） */
  tool: 'bash' | 'powershell';
  command: string;
}> = [
  { tool: 'bash', command: 'git status' },
  { tool: 'bash', command: 'ls' },
  { tool: 'bash', command: 'cat package.json' },
  { tool: 'bash', command: 'npm run build' },
  { tool: 'bash', command: 'mkdir build' },
  { tool: 'powershell', command: 'Get-ChildItem' },
  { tool: 'powershell', command: 'git status' },
  { tool: 'powershell', command: 'Get-Content package.json' },
  { tool: 'powershell', command: 'npm run build' },
  { tool: 'powershell', command: 'New-Item -ItemType Directory build' },
];

/**
 * 该工具的基准命令（非命令类工具 ⇒ 空数组，调用方据此返回 `null`）。
 *
 * `pwsh` 与 `powershell` 同方言，共用一份基线。
 */
export function baselineCommandsForTool(toolName: string): string[] {
  const lower = toolName.toLowerCase();
  if (lower !== 'bash' && lower !== 'powershell' && lower !== 'pwsh') return [];
  const canonical = lower === 'bash' ? 'bash' : 'powershell';
  return RULE_IMPACT_BASELINE.filter((entry) => entry.tool === canonical).map(
    (entry) => entry.command
  );
}

/** 单条基准的前后结论 */
export interface RuleImpactSample {
  toolName: string;
  command: string;
  before: RuleImpactDecision;
  after: RuleImpactDecision;
}

export interface RuleImpactCase extends RuleImpactSample {
  /** `true` = 该基准被新规则**变差**（ask/allow → deny） */
  degraded: boolean;
}

export interface RuleImpactPreview {
  /** 预演所用的判定档（自动档只读工具级规则，内容级规则不参与） */
  mode: 'auto' | 'default';
  /** 逐条基准的前后结论 */
  cases: RuleImpactCase[];
  /** 变差的基准命令（空 = 无阻断影响） */
  degradedCommands: string[];
  /** 是否存在"变差"（true ⇒ 写接口要求显式确认） */
  degraded: boolean;
  /** 口径说明（前端原样展示） */
  note: string;
}

/**
 * 汇总预演结果（纯函数）。
 *
 * 只有"变差"才阻断：`deny → ask/allow` 是收紧后的放宽（由用户主动确认），不在此列。
 */
export function summarizeRuleImpact(
  mode: 'auto' | 'default',
  samples: RuleImpactSample[]
): RuleImpactPreview {
  const cases: RuleImpactCase[] = samples.map((sample) => ({
    ...sample,
    degraded: sample.before !== 'deny' && sample.after === 'deny',
  }));
  const degradedCommands = cases
    .filter((entry) => entry.degraded)
    .map((entry) => entry.command);
  return {
    mode,
    cases,
    degradedCommands,
    degraded: degradedCommands.length > 0,
    note:
      '基准命令为内置清单（git status / ls / cat / npm run build / mkdir 及 PowerShell 对应项）；' +
      '只检测"变差"（ask/allow → deny）。自动档只读工具级规则，内容级规则请用 default 档理解。',
  };
}

/** 候选规则（与 `AddRuleInput` 的匹配维度一致） */
export interface RuleImpactCandidate {
  behavior: PermissionBehavior;
  toolName: string;
  contentPattern?: string;
}
