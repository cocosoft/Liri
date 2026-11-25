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
 * 许愿式（demand）的**执行侧契约**：非危险命令不再逐条弹审批（P0，2026-11-17）。
 *
 * 背景（真机会话 `session_mwk2fakzf30b34b448`）：`demand` 此前只约束"不许与 plan 组合"，
 * `auto` 档对未收录命令仍 fail-closed ⇒ 19 张审批卡里 12 张来自无害命令，
 * 与"只给目标、做到交付（中途最多问一次）"直接冲突。
 *
 * 本文件双向钉住：
 *  ① demand ⇒ 分类器的"非危险需审批"降级为自动放行（写目标在工作区内）；
 *  ② 写类命令 / 工作区外写 / 危险命令 / 非 demand 会话 ⇒ **保持原有档位**（不回退安全姿态）。
 */
import { describe, expect, it } from 'bun:test';

import { shouldAutoAllowUnderDemand } from '../../../packages/infra/src/permission/autonomyPermission';
import { handleAuto } from '../../../packages/infra/src/permission/manager/modeHandlers';
import { createPermissionContext } from '../../../packages/infra/src/permission/types/PermissionContext';
import {
  PermissionDecisionType,
  type PermissionDecision,
} from '../../../packages/infra/src/permission/types/PermissionDecision';
import type { ModeHandlerDeps } from '../../../packages/infra/src/permission/manager/modeHandlers';
import {
  ENV_DEMAND_AUTO_ALLOW_MAX,
  resetDemandAutoAllowQuota,
} from '../../../packages/infra/src/permission/demandAutoAllowQuota';

const WORKSPACE = process.platform === 'win32' ? 'C:\\work' : '/work';

/** 分类器桩：按用例指定"非危险需审批 / 危险" */
function makeDeps(
  classifier: { requiresApproval?: boolean; shouldBlock?: boolean } = {
    requiresApproval: true,
  }
): ModeHandlerDeps {
  return {
    ruleManager: {
      getDenyRuleForTool: () => undefined,
      getAskRuleForTool: () => undefined,
      toolAlwaysAllowedRule: () => undefined,
      // 2026-11-25：auto 档新增 call 级规则查询（内容级 deny / ask / allow）
      getMatchingRule: () => undefined,
    },
    denialTracker: {
      trackSuccess: () => {},
      trackDenial: () => {},
    },
    classifierManager: {
      isAllowlistedTool: () => false,
      classify: async () => ({
        shouldBlock: classifier.shouldBlock === true,
        requiresApproval: classifier.requiresApproval === true,
        reason: classifier.shouldBlock
          ? 'Input contains dangerous command pattern'
          : 'Unknown command requires approval (not covered by any rule)',
      }),
    },
    messages: [],
    defaultBehavior: 'allow',
    permissionChecker: {},
    checkFineGrainedRules: async () => ({}),
  } as unknown as ModeHandlerDeps;
}

async function decide(
  command: string,
  autonomy: 'interactive' | 'demand' | undefined,
  deps: ModeHandlerDeps = makeDeps(),
  sessionId?: string
): Promise<PermissionDecision> {
  const context = createPermissionContext({
    toolName: 'bash',
    input: { command },
    permissionMode: 'auto',
    workspacePath: WORKSPACE,
    ...(sessionId ? { sessionId } : {}),
    ...(autonomy ? { autonomy } : {}),
  });
  return handleAuto(deps, 'bash', { command }, context);
}

describe('shouldAutoAllowUnderDemand（纯函数）', () => {
  it('demand + 需审批 + 无界外写 ⇒ true', () => {
    expect(
      shouldAutoAllowUnderDemand({
        autonomy: 'demand',
        requiresApproval: true,
        writeOutsideWorkspace: false,
      })
    ).toBe(true);
  });

  it('非 demand / 非需审批 / 有界外写 ⇒ false', () => {
    expect(
      shouldAutoAllowUnderDemand({
        autonomy: 'interactive',
        requiresApproval: true,
        writeOutsideWorkspace: false,
      })
    ).toBe(false);
    expect(
      shouldAutoAllowUnderDemand({
        autonomy: undefined,
        requiresApproval: true,
        writeOutsideWorkspace: false,
      })
    ).toBe(false);
    expect(
      shouldAutoAllowUnderDemand({
        autonomy: 'demand',
        requiresApproval: false,
        writeOutsideWorkspace: false,
      })
    ).toBe(false);
    expect(
      shouldAutoAllowUnderDemand({
        autonomy: 'demand',
        requiresApproval: true,
        writeOutsideWorkspace: true,
      })
    ).toBe(false);
  });
});

describe('handleAuto：许愿式不再逐条弹审批（且安全边界不回退）', () => {
  it('① demand + 未收录只读命令 ⇒ allow（不再 ask）', async () => {
    const decision = await decide('some-unknown-cli --list', 'demand');
    expect(decision.type).toBe(PermissionDecisionType.ALLOW);
    expect(String(decision.reason)).toContain('demand');
  });

  it('② 非 demand（interactive）⇒ 同命令仍 ask（零行为变更）', async () => {
    const decision = await decide('some-unknown-cli --list', 'interactive');
    expect(decision.type).toBe(PermissionDecisionType.ASK);
  });

  it('③ demand + 写类命令（copy）⇒ 仍 ask（目标无法可靠界定）', async () => {
    const decision = await decide('copy a.txt C:\\Windows\\b.txt', 'demand');
    expect(decision.type).toBe(PermissionDecisionType.ASK);
  });

  it('④ demand + 重定向到工作区外 ⇒ 仍 ask', async () => {
    const outside =
      process.platform === 'win32' ? 'C:\\Users\\x\\out.txt' : '/etc/out.txt';
    const decision = await decide(`echo hi > ${outside}`, 'demand');
    expect(decision.type).toBe(PermissionDecisionType.ASK);
  });

  it('⑤ demand + 重定向到工作区内 ⇒ allow', async () => {
    const decision = await decide('echo hi > .\\out.txt', 'demand');
    expect(decision.type).toBe(PermissionDecisionType.ALLOW);
  });

  it('⑥ demand + 危险命令（分类器阻断）⇒ 仍 deny', async () => {
    const decision = await decide(
      'rm -rf /',
      'demand',
      makeDeps({ shouldBlock: true })
    );
    expect(decision.type).toBe(PermissionDecisionType.DENY);
  });

  it('⑦ demand + 硬拒命令（runas）⇒ 仍 ask（B3 兜底）', async () => {
    const decision = await decide('runas /user:Administrator cmd', 'demand');
    expect(decision.type).toBe(PermissionDecisionType.ASK);
  });

  it('⑧ killswitch 关闭 ⇒ demand 下未知命令也回退为 ask', async () => {
    const key = 'LIRI_DEMAND_AUTO_ALLOW';
    const prev = process.env[key];
    process.env[key] = 'false';
    try {
      const decision = await decide('some-unknown-cli --list', 'demand');
      expect(decision.type).toBe(PermissionDecisionType.ASK);
    } finally {
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  });

  it('⑨ 每会话配额用尽 ⇒ 回落 ask；别的会话不受影响（B3 余项）', async () => {
    resetDemandAutoAllowQuota();
    const prev = process.env[ENV_DEMAND_AUTO_ALLOW_MAX];
    process.env[ENV_DEMAND_AUTO_ALLOW_MAX] = '1';
    try {
      const first = await decide(
        'some-unknown-cli --list',
        'demand',
        makeDeps(),
        'quota-session-a'
      );
      expect(first.type).toBe(PermissionDecisionType.ALLOW);

      // 同会话第二次：配额已用尽 ⇒ 回到 ask（不 deny）
      const second = await decide(
        'some-unknown-cli --list',
        'demand',
        makeDeps(),
        'quota-session-a'
      );
      expect(second.type).toBe(PermissionDecisionType.ASK);

      // 另一个会话的配额独立
      const other = await decide(
        'some-unknown-cli --list',
        'demand',
        makeDeps(),
        'quota-session-b'
      );
      expect(other.type).toBe(PermissionDecisionType.ALLOW);
    } finally {
      if (prev === undefined) delete process.env[ENV_DEMAND_AUTO_ALLOW_MAX];
      else process.env[ENV_DEMAND_AUTO_ALLOW_MAX] = prev;
      resetDemandAutoAllowQuota();
    }
  });
});
