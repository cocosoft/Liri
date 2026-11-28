/**
 * 命令退出码语义（P1-1 / P1-3，2026-11-06）
 *
 * 只做**结构化归类**，不改安全判定：
 *  - `lastCommandSegment()`：取管道/串联的最后一段（`|`、`||`、`&&`、`;` 都算分隔），
 *    供「检索无匹配」与「检查未通过」两条判定共用；
 *  - `isExpectedNonzeroExit()`：检查/测试类命令以非零退出码结束 ⇒ 是**有效结果**而非工具故障。
 *  - `isEnvironmentProbeFailure()`（P0-2，2026-11-27）：安装失败 / 命令不存在探测失败
 *    ⇒ **环境层**阻塞（本机缺依赖），不得按"模型无效输出"计 invalid。
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

/**
 * 环境层失败的命令族（P0-2，2026-11-27）：**失败原因是本机环境，而不是模型输出无效**。
 *
 * 真机 `session_mwz477wj251057474e`：模型为"把已写好的 SVG 转 PNG"连续执行
 * `npm install @resvg/resvg-js` → `where magick & where inkscape …` → `pip install cairosvg`，
 * 三次都因**本机缺依赖/装不上**而失败，却按"通用工具失败"计入 `consecutiveInvalidTurns`
 * ⇒ 3 轮即 `circuit_breaker` 整轮中断（用户看到的是"画到一半报错"）。
 *
 * 这里只做**结构化分类**（按命令族 + 非零退出），不解析错误文案（CS02）：
 *  - 依赖获取类（安装命令失败 ⇒ 依赖仍不可用）；
 *  - 可执行文件探测类（`where` / `which` / `command -v` 非零退出 = 本机没有该命令）。
 *
 * 调用方据此写 `failureKind='env_unavailable'` ⇒ `classifyTurn()` 判 environment_blocked
 * （2 轮即给出可执行结论，而不是当模型犯错直接熔断）。
 */
const ENV_PROBE_SEGMENT_PATTERNS: readonly RegExp[] = [
  // 依赖获取：任一包管理器安装失败 ⇒ 依赖仍不可用（网络/仓库/权限都属环境层）
  /^(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|ci)\b/i,
  /^(?:pip|pip3|python\s+-m\s+pip|py\s+-m\s+pip)\s+install\b/i,
  /^(?:uv(?:\s+pip)?|pipx|poetry)\s+(?:install|add)\b/i,
  /^(?:winget|choco|scoop)\s+install\b/i,
  /^(?:apt-get|apt|brew|dnf|yum)\s+install\b/i,
  // 可执行文件存在性探测：非零退出 = "没找到"，属事实查询而非工具故障
  /^(?:where|which|command\s+-v)\b/i,
  // 路径存在性探测（POSIX `test -e/-f/-d`）：非零 = "不存在"，同属事实查询
  /^test\s+-(?:e|f|d)\b/i,
];

/**
 * **模块导入探测**（2026-11-28 补，真机 `session_mwz477wj251057474e` 15:31Z 段）：
 * `python -c "import cairosvg; print('cairosvg ok')"` / `node -e "require('sharp')"`。
 *
 * 为什么不能沿用上面的"取最后一段"口径：这类命令体内部常带 `;`
 *（`import X; print(...)`），按 `;` 切段后最后一段只剩 `print(...)` ⇒ 永远匹配不到。
 * 因此对**整条命令**匹配头部形态（仅当整条就是一次探测调用；带 `&&` 的复合命令不在此列）。
 *
 * 刻意**不含** `dir /b <path>` / `ls <path>`：那既可能是"依赖是否存在"的探测，
 * 也可能是"我的产物是否写出来了"的核对 —— 后者失败属**真实任务未达成**，
 * 交给既有 invalid / 步骤裁决，不在此洗白。
 */
const MODULE_PROBE_PATTERN =
  /^(?:(?:python[0-9.]*|py)\s+-c\s+["']?\s*(?:import|from)\s|node\s+(?:-e|-p)\s+["']?[^"']{0,60}?require\()/i;

/**
 * 是否整条命令**只由**模块导入探测组成（`&` 串联的多个探测也算；`|` / `||` 一律不算）。
 *
 * 为什么按 `&` 切而不是按 `;`：探测体内常带 `;`（`import X; print(...)`），按 `;` 切会让
 * 每一段都不完整。`|` / `||` 会让"退出码语义主体"不明确 ⇒ 直接排除，不判形。
 */
function isModuleProbeChain(command: string): boolean {
  const normalized = command.replace(/\d?>&\d/g, '').trim();
  if (!normalized || /\|/.test(normalized)) return false;
  const parts = normalized
    .split(/&&|&/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 && parts.every((p) => MODULE_PROBE_PATTERN.test(p));
}

/**
 * 是否属于「环境层失败」（安装失败 / 命令不存在探测失败）。
 *
 * 只看**最后一段**：退出码来自最后一段（`cd X && npm install` 的语义主体是安装；
 * `npm i a & del b` 的最后一段是 `del b` ⇒ 不误判）。`&` 也作为分隔符切分。
 */
export function isEnvironmentProbeFailure(params: {
  command?: string;
  exitCode?: number;
}): boolean {
  if (params.exitCode === undefined || params.exitCode === 0) return false;
  const command = (params.command ?? '').trim();
  if (!command) return false;
  // 2026-11-28：模块导入探测 —— 单条或 `&` 串联时按整条判形（体内含 `;`，按 `;` 切段会失效）
  if (isModuleProbeChain(command)) return true;
  const segments = command
    .split(/\|\||&&|[|;&]/)
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
  const last = segments[segments.length - 1] ?? '';
  return (
    MODULE_PROBE_PATTERN.test(last) ||
    ENV_PROBE_SEGMENT_PATTERNS.some((re) => re.test(last))
  );
}
