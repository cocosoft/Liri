// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 命令级免审批的 `contentPattern` 生成（2026-11-21）。
 *
 * 回归背景（真机 `session_mwpit6sk32d12fe50b` / `session_mwpj4amge75a67ec4f`）：
 * 「以后这个命令免审批」对 `powershell -NoProfile -Command "…"` 写入
 * `^powershell -NoProfile.*` ⇒ 放行整个 PowerShell；同时后续 `powershell -Command "…"`
 * 又因不在白名单反复弹审批。解释器/壳必须走**精确匹配**。
 */

import { describe, expect, it } from 'bun:test';

import {
  buildCommandContentPattern,
  isInterpreterCommandHead,
  normalizeCommandHead,
} from '@openliri/infra/permission/commandPatterns';
import {
  createPermissionRule,
  isRuleMatch,
  PermissionBehavior,
} from '@openliri/infra/permission/types/PermissionRule';

function allowRule(toolName: string, contentPattern: string) {
  return createPermissionRule({
    behavior: PermissionBehavior.ALLOW,
    toolName,
    contentPattern,
  });
}

describe('buildCommandContentPattern：解释器/壳 ⇒ 精确匹配', () => {
  it('powershell -NoProfile ... ⇒ 锚定整条命令（不再放行整个解释器）', () => {
    const command =
      'powershell -NoProfile -Command "Get-ChildItem E:\\tmp -Recurse"';
    const pattern = buildCommandContentPattern(command);
    expect(pattern).toBe(
      '^powershell -NoProfile -Command "Get-ChildItem E:\\\\tmp -Recurse"$'
    );

    const rule = allowRule('bash', pattern);
    expect(isRuleMatch(rule, 'bash', { command })).toBe(true);
    // 换参数 ⇒ 必须重新审批
    expect(
      isRuleMatch(rule, 'bash', {
        command: 'powershell -NoProfile -Command "Remove-Item E:\\tmp"',
      })
    ).toBe(false);
  });

  it('完整路径 powershell.exe 也按解释器处理（去目录 / 去 .exe / 小写）', () => {
    const command =
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -Command "Get-Item x"';
    const pattern = buildCommandContentPattern(command);
    expect(pattern.startsWith('^C:\\\\Windows\\\\System32')).toBe(true);
    expect(pattern.endsWith('$')).toBe(true);
    const rule = allowRule('bash', pattern);
    expect(isRuleMatch(rule, 'bash', { command })).toBe(true);
    expect(
      isRuleMatch(rule, 'bash', {
        command:
          'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -Command "Get-Item y"',
      })
    ).toBe(false);
  });

  it.each([
    ['cmd /c dir /b', 'cmd'],
    ['sh -c "ls"', 'sh'],
    ['bash -lc "ls"', 'bash'],
    ['python -c "print(1)"', 'python'],
    ['node -e "console.log(1)"', 'node'],
    // P1（2026-11-22）：壳 / 包装器全族都必须精确匹配（旧集合只有 bash/sh/zsh/fish）
    ['dash -c "git log"', 'dash'],
    ['ksh -c "ls"', 'ksh'],
    ['busybox sh -c "ls"', 'busybox'],
    ['env NO_COLOR=1 git log', 'env'],
  ])('%s ⇒ 精确匹配（head=%s）', (command, head) => {
    expect(isInterpreterCommandHead(normalizeCommandHead(head))).toBe(true);
    expect(buildCommandContentPattern(command)).toBe(
      `^${String(command).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
    );
  });
});

describe('buildCommandContentPattern：非解释器保持前缀口径', () => {
  it('dir /b ⇒ ^dir /b.*（与历史行为逐字一致）', () => {
    expect(buildCommandContentPattern('dir /b')).toBe('^dir /b.*');
  });

  it('net user %username% ⇒ ^net user.*', () => {
    expect(buildCommandContentPattern('net user %username%')).toBe(
      '^net user.*'
    );
  });

  it('前缀规则仍命中同前缀的不同参数', () => {
    const rule = allowRule('bash', buildCommandContentPattern('dir /b'));
    expect(isRuleMatch(rule, 'bash', { command: 'dir /b /ad' })).toBe(true);
  });
});
