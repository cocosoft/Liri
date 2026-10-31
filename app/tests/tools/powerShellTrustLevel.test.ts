// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * PowerShell 信任分级接线（2026-10-31，台账「PowerShell 信任分级」项）
 *
 * 改造前：`PowerShellTool` 内 `trustLevel` **零命中**，而 `BashTool` 已把
 * `securityIntegrationService.getTrustLevelForPath(cwd)` 传给分析器 ⇒ 同一台机器上
 * bash 与 PowerShell 的信任姿态不一致：受信工作区里 `whoami` / `hostname` 这类
 * **非白名单但非危险**的命令被硬拒，且没有审批机会。
 *
 * 本轮口径（与 Bash 同源、**只放宽 "白名单未命中" 一档**）：
 *  - `development` / `work` ⇒ 白名单外的非危险命令放行；
 *  - 未传 / 其它级别 ⇒ 保持既有硬拒（fail-closed，零行为变更）；
 *  - 分析器 `ask`（递归删除等）与沙箱 `deny`（格式化等）**任何级别都不放宽**。
 */
import { describe, expect, test } from 'bun:test';

import {
  evaluatePowerShellSecurity,
  type PowerShellSecurityDecision,
} from '../../src/tools/PowerShellTool/PowerShellTool';
import { checkPowerShellWrapper } from '../../src/tools/bash/powerShellWrapper';

/** 白名单外、非危险（真机上模型常用） */
const NOT_WHITELISTED_SAFE = 'whoami';
/** 分析器判 ask：递归删除 */
const ASK_CASE = 'Remove-Item C:\\Windows -Recurse';
/** 分析器判 deny：格式化卷 */
const DENY_CASE = 'format-volume D:';

function decide(
  command: string,
  trustLevel?: string
): PowerShellSecurityDecision {
  return evaluatePowerShellSecurity(
    command,
    trustLevel === undefined ? {} : { trustLevel }
  );
}

describe('evaluatePowerShellSecurity：信任级别》只放宽「白名单未命中」', () => {
  test('未传 trustLevel（未受信）⇒ 白名单外命令仍硬拒（零行为变更）', () => {
    const d = decide(NOT_WHITELISTED_SAFE);

    expect(d.allowed).toBe(false);
    expect(d.behavior).toBe('deny');
    expect(d.code).toBe('COMMAND_NOT_ALLOWED');
  });

  test('work ⇒ 白名单外非危险命令放行，且报文带可追溯的信任标记', () => {
    const d = decide(NOT_WHITELISTED_SAFE, 'work');

    expect(d.allowed).toBe(true);
    expect(d.behavior).toBe('allow');
    expect(String(d.message)).toContain('[信任工作区·work]');
  });

  test('development ⇒ 同样为 allow（与 Bash 的 development 口径一致）', () => {
    const d = decide('hostname', 'development');

    expect(d.allowed).toBe(true);
    expect(d.behavior).toBe('allow');
  });

  test('负向：分析器命中（递归删除 / 用户配置黑名单）在任何信任级别下都**不**放行', () => {
    // 注：分析器构造时会合并用户 `config` 的自定义黑名单 ⇒ 同一命令在
    // 「干净环境」判 ask、在带黑名单的环境可能判 deny。本用例只锁"绝不放行"。
    for (const level of [undefined, 'chat', 'work', 'development']) {
      const d = decide(ASK_CASE, level);
      expect(d.allowed).toBe(false);
      expect(d.behavior).not.toBe('allow');
    }
  });

  test('负向：沙箱/分析器 deny（格式化卷）在任何信任级别下都**不**放行', () => {
    for (const level of [undefined, 'work', 'development']) {
      const d = decide(DENY_CASE, level);
      expect(d.allowed).toBe(false);
      expect(d.behavior).toBe('deny');
    }
  });
});

describe('checkPowerShellWrapper：内层脚本与直接执行同一信任口径', () => {
  const wrapped = `powershell -Command "${NOT_WHITELISTED_SAFE}"`;

  test('未传 trustLevel ⇒ 内层白名单外命令仍被拒（fail-closed 保持）', () => {
    const blocked = checkPowerShellWrapper(wrapped);
    expect(blocked).not.toBeNull();
    expect(String(blocked?.error)).toContain('不在允许列表');
  });

  test('传 work ⇒ 内层非危险命令放行（与直接调用 PowerShellTool 一致）', () => {
    expect(checkPowerShellWrapper(wrapped, undefined, 'work')).toBeNull();
  });

  test('负向：trustLevel=work 也不能放行内层危险命令', () => {
    const blocked = checkPowerShellWrapper(
      `powershell -Command "${DENY_CASE}"`,
      undefined,
      'work'
    );
    expect(blocked).not.toBeNull();
  });
});
