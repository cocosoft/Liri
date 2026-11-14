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
 * DreamDenyRules — 自主运行执行安全规则（D1-Step2，对标 PilotDeck 执行阶段 deny 规则）
 *
 * 自主运行（无人值守）场景下，即使配置了权限放行，也必须永久拒绝以下操作——
 * 防止 AI 自主执行时对远程仓库/系统造成不可逆影响。
 *
 * 当前为基础设施：dream 引擎本身不直接执行 shell；当自主运行升级为
 * "可执行工作区变更"时，这些规则注入执行上下文（如 PermissionRuntime deny 列表）。
 */

/** 自主运行期间永久 deny 的命令前缀 */
export const AUTONOMOUS_DENY_COMMAND_PREFIXES: string[] = [
  'git push',
  'git remote',
  'git reset --hard',
  'git clean -f',
  'rm -rf /',
  'sudo ',
  'Format-Volume',
  'Remove-Item -Recurse',
  'Stop-Process -Force',
];

/** 自主运行期间永久 deny 的工具名 */
export const AUTONOMOUS_DENY_TOOLS: string[] = [
  'shell_gateway', // 网关通道
  'cron', // 自主运行期间禁止修改调度
  'message_send', // 自主运行禁止主动发消息（避免骚扰）
];

/**
 * 判断命令是否命中自主运行 deny 规则
 */
export function isDeniedByAutonomousRules(command: string): boolean {
  const normalized = command.trim();
  return AUTONOMOUS_DENY_COMMAND_PREFIXES.some((prefix) =>
    normalized.toLowerCase().startsWith(prefix.toLowerCase())
  );
}

/**
 * 判断工具名是否命中自主运行 deny 规则
 */
export function isDeniedToolByAutonomousRules(toolName: string): boolean {
  return AUTONOMOUS_DENY_TOOLS.includes(toolName);
}

/**
 * 检查自主执行前的操作是否允许（统一入口，供调度/执行层调用）
 */
export function checkAutonomousOperation(input: {
  toolName?: string;
  command?: string;
}): { allowed: boolean; reason?: string } {
  if (input.command && isDeniedByAutonomousRules(input.command)) {
    return {
      allowed: false,
      reason: `自主运行禁止执行命令：${input.command.slice(0, 80)}`,
    };
  }
  if (input.toolName && isDeniedToolByAutonomousRules(input.toolName)) {
    return {
      allowed: false,
      reason: `自主运行禁止调用工具：${input.toolName}`,
    };
  }
  return { allowed: true };
}
