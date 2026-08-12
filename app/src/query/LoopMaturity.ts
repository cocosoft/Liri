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
 * LoopMaturityLevel — 循环成熟度分级
 *
 * Phase 4 新增。对标 loop-engineering-main 的 L0-L3 四级成熟度。
 * 在 TAORLoop 启动时检查当前配置，决定允许的操作范围。
 */

import { configManager } from '@modules/config';

/** 成熟度级别 */
type MaturityLevel = 'L0' | 'L1' | 'L2' | 'L3';

/** 各成熟度级别的能力配置 */
interface MaturityCapability {
  /** 可用的工具白名单（空=全部） */
  allowedTools: string[];
  /** 最多执行轮数 */
  maxTurns: number;
  /** 是否需要人工确认 */
  requireConfirmation: boolean;
  /** 是否允许生成子Agent */
  allowSubAgents: boolean;
  /** 是否允许文件写入 */
  allowWrite: boolean;
}

/** 成熟度能力表 */
const MATURITY_CAPABILITIES: Record<MaturityLevel, MaturityCapability> = {
  L0: {
    allowedTools: [],
    maxTurns: 0,
    requireConfirmation: true,
    allowSubAgents: false,
    allowWrite: false,
  },
  L1: {
    allowedTools: ['web_search', 'read_file', 'search_files', 'glob', 'grep'],
    maxTurns: 5,
    requireConfirmation: true,
    allowSubAgents: false,
    allowWrite: false,
  },
  L2: {
    allowedTools: [],
    maxTurns: 20,
    requireConfirmation: true,
    allowSubAgents: false,
    allowWrite: true,
  },
  L3: {
    allowedTools: [],
    maxTurns: 50,
    requireConfirmation: false,
    allowSubAgents: true,
    allowWrite: true,
  },
};

/** 从环境变量读取当前级别 */
function resolveMaturityLevel(): MaturityLevel {
  const raw = configManager.env('LOOP_MATURITY_LEVEL') ?? 'L1';
  const valid: MaturityLevel[] = ['L0', 'L1', 'L2', 'L3'];
  return valid.includes(raw as MaturityLevel) ? (raw as MaturityLevel) : 'L1';
}

export class LoopMaturity {
  readonly level: MaturityLevel;
  readonly capability: MaturityCapability;

  constructor(level?: MaturityLevel) {
    this.level = level ?? resolveMaturityLevel();
    this.capability = MATURITY_CAPABILITIES[this.level];
  }

  /** 是否可执行（非 L0） */
  canExecute(): boolean {
    return this.level !== 'L0';
  }

  /** 是否需要人工确认 */
  requireConfirmation(): boolean {
    return this.capability.requireConfirmation;
  }

  /** 升级路径：满足条件后可以晋级 */
  canUpgrade(stats: {
    successfulRuns: number;
    consecutiveSuccesses: number;
  }): MaturityLevel | null {
    if (this.level === 'L1' && stats.consecutiveSuccesses >= 10) return 'L2';
    if (
      this.level === 'L2' &&
      stats.successfulRuns >= 50 &&
      stats.consecutiveSuccesses >= 20
    )
      return 'L3';
    return null;
  }
}

export function createLoopMaturity(level?: MaturityLevel): LoopMaturity {
  return new LoopMaturity(level);
}
