// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2 待办 1/2 前半程：bash 安全门**登记表与源码对账**（2026-11-05）。
 *
 * 表本身不改控制流（`BashTool` 仍逐个调用判据函数）；本文件保证"登记的事实"与代码一致：
 *   ① 顺序：表里的 `order` 必须与 `BashTool.execute` 的实际调用顺序一致；
 *   ② reason 码：源码里出现的每个 `reason: '<code>'` 都必须在表里登记（新门/新码不许漏登）；
 *   ③ 豁免：标 `askExemptable: true` 的门，源码调用点必须真传了审批上下文；
 *   ④ 分类：全部门的拦截都归 `safety_blocked`（LRO-09 环境阻塞预算）。
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  COMMAND_GATES,
  COMMAND_GATE_ORDER,
  listCommandGateReasons,
} from '../../src/tools/bash/commandGateRegistry';
import type { CommandGateId } from '../../src/tools/bash/commandGateRegistry';

const read = (rel: string): string =>
  readFileSync(new URL(rel, import.meta.url), 'utf8');

const BASH_TOOL = read('../../src/tools/bash/BashTool.ts');
const GATE_SRC = read('../../src/tools/bash/bashSecurityGate.ts');
const PSW_SRC = read('../../src/tools/bash/powerShellWrapper.ts');

/** BashTool 里各门调用点的锚点（顺序即执行顺序） */
const CALL_ANCHORS: Record<CommandGateId, string> = {
  path_safety: 'checkPathSafety(std)',
  dangerous_command: 'checkBashDangerousCommand(command)',
  powershell_wrapper: 'checkPowerShellWrapper(',
  ast_analyzer: 'checkAstAndAnalyzer({',
  whitelist_sandbox: 'checkWhitelistAndSandbox(command, std)',
  interpreter_guard: 'checkInterpreterGuard({',
};

describe('安全门登记表：顺序与源码一致', () => {
  it('表内 order 与 BashTool 的实际调用顺序逐一对齐', () => {
    const positions = COMMAND_GATE_ORDER.map((id) => ({
      id,
      at: BASH_TOOL.indexOf(CALL_ANCHORS[id]),
    }));

    for (const { id, at } of positions) {
      expect(`${id}@${at}`).not.toBe(`${id}@-1`);
    }
    const sorted = [...positions].sort((a, b) => a.at - b.at).map((p) => p.id);
    expect(sorted).toEqual([...COMMAND_GATE_ORDER]);
  });

  it('order 从 1 起连续，无重复', () => {
    const orders = COMMAND_GATE_ORDER.map((id) => COMMAND_GATES[id].order);
    expect(orders).toEqual(orders.map((_, i) => i + 1));
  });
});

describe('安全门登记表：reason 码双向对账', () => {
  const sourceReasons = (): string[] => {
    const found = new Set<string>();
    for (const src of [GATE_SRC, PSW_SRC]) {
      for (const m of src.matchAll(/reason:\s*'([a-z_]+)'/g)) {
        if (m[1]) found.add(m[1]);
      }
    }
    return [...found].sort();
  };

  it('源码里出现的每个 reason 码都已登记', () => {
    const registered = new Set(listCommandGateReasons());
    const missing = sourceReasons().filter((r) => !registered.has(r));
    expect(missing).toEqual([]);
  });

  it('表里登记的每个 reason 码都在源码里真实存在（无僵尸登记）', () => {
    const inSource = new Set(sourceReasons());
    const stale = listCommandGateReasons().filter((r) => !inSource.has(r));
    expect(stale).toEqual([]);
  });
});

describe('安全门登记表：豁免与失败分类', () => {
  it('标 askExemptable 的门，调用点必须真传审批上下文', () => {
    const passingApproval = new Set<CommandGateId>();
    if (/checkAstAndAnalyzer\(\{[\s\S]{0,400}?bypassAsk/.test(BASH_TOOL)) {
      passingApproval.add('ast_analyzer');
    }
    if (/checkInterpreterGuard\(\{[\s\S]{0,300}?isApproved/.test(BASH_TOOL)) {
      passingApproval.add('interpreter_guard');
    }

    const declared = COMMAND_GATE_ORDER.filter(
      (id) => COMMAND_GATES[id].askExemptable
    );
    expect([...declared].sort()).toEqual([...passingApproval].sort());
  });

  it('全部门的拦截都归 safety_blocked（环境阻塞预算）', () => {
    for (const id of COMMAND_GATE_ORDER) {
      expect(COMMAND_GATES[id].failureKind).toBe('safety_blocked');
    }
    // 拦截结果构造处确实写入了该分类
    expect(GATE_SRC).toContain("failureKind: 'safety_blocked'");
  });
});
