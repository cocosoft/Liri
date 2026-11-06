/**
 * 命令退出码语义（P1-1 / P1-3，2026-11-06）
 *
 * 只做**结构化归类**，不改安全判定：
 *  - `lastCommandSegment()`：取管道/串联的最后一段（`|`、`||`、`&&`、`;` 都算分隔），
 *    供「检索无匹配」与「检查未通过」两条判定共用；
 *  - `isExpectedNonzeroExit()`：检查/测试类命令以非零退出码结束 ⇒ 是**有效结果**而非工具故障。
 *
 * 真机背景（`session_mw458fpp3ea32a050e`）：连续 3 次 `tsc --noEmit` 报类型错（退出码 1）
 * 被计入 `consecutiveInvalidTurns` 并触发 `circuit_breaker`，而模型正在按错误修代码。
 *
 * **判据刻意收窄**：只覆盖"未通过即非零退出"这一约定明确成立的命令族；其余命令的非零
 * 退出仍按工具失败处理（fail-closed，不把真故障洗白）。
 */

/** 检查/测试类命令族（匹配在**任一段**上；退出码非零即"未通过"） */
const EVIDENCE_COMMAND_PATTERNS: readonly RegExp[] = [
  // TypeScript / 类型检查（含 npx/bunx/pnpm exec/yarn 包装与 Windows 路径形式）
  /^(?:npx|bunx|bun\s+x|pnpm(?:\s+exec)?|yarn)\s+(?:tsc|tsgo|vue-tsc|svelte-check)\b/i,
  /^(?:tsc|tsgo|vue-tsc)\b/i,
  /(?:^|[\\/])node_modules[\\/]\.bin[\\/](?:tsc|tsgo|vue-tsc)(?:\.cmd|\.exe)?\b/i,
  // 测试运行器
  /^(?:npx|bunx|bun\s+x|pnpm(?:\s+exec)?|yarn)\s+(?:vitest|jest|mocha|ava)\b/i,
  /^(?:vitest|jest|mocha)\b/i,
  /^(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?test(?::[\w.-]+)?\b/i,
  // lint / typecheck 脚本
  /^(?:npx|bunx|bun\s+x|pnpm(?:\s+exec)?|yarn)\s+eslint\b/i,
  /^eslint\b/i,
  /^(?:bun|npm|pnpm|yarn)\s+run\s+(?:lint|typecheck|check)(?::[\w.-]+)?\b/i,
  // git 以退出码表达"有差异"
  /^git\s+diff\b[\s\S]*--(?:exit-code|quiet)\b/i,
];

/** 取管道/串联的最后一段（`|`、`||`、`&&`、`;` 都算分隔） */
export function lastCommandSegment(command: string): string {
  const parts = command.split(/\|\||&&|[|;]/);
  return (parts[parts.length - 1] ?? '').trim();
}

/**
 * 是否属于「检查/测试类命令以非零退出码结束」。
 *
 * 复合命令（`cd X && npx tsc` / `npx tsc 2>&1 | Select-Object …`）按段检查：
 * 任一段命中命令族即认定 —— 错误输出仍原样回给模型，不掩盖问题。
 */
export function isExpectedNonzeroExit(params: {
  command?: string;
  exitCode?: number;
}): boolean {
  if (params.exitCode === undefined || params.exitCode === 0) return false;
  const command = (params.command ?? '').trim();
  if (!command) return false;
  return command.split(/\|\||&&|[|;]/).some((segment) => {
    const s = segment.trim().replace(/^["']|["']$/g, '');
    return EVIDENCE_COMMAND_PATTERNS.some((re) => re.test(s));
  });
}
