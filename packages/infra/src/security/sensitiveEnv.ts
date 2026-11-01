/**
 * 敏感环境变量剥离 — 单一事实源（A3 / 2026-10-09）
 *
 * 供所有「把父进程 env 传给子进程」的路径复用（BashTool spawn、hooks 脚本执行等），
 * 避免多处各写一份剥离清单（CS01：禁止重复造轮子）。
 *
 * 口径来源（既有 hooks 侧，避免第二份）：
 * - 子串族：`EnvironmentManager.sanitizeEnvironment` 的
 *   `['PASSWORD','TOKEN','SECRET','KEY','AUTH']`；本处补 `CREDENTIAL`（覆盖
 *   `GOOGLE_APPLICATION_CREDENTIALS` 等云凭据）。
 * - 具名清单：`ScriptHookExecutor.buildEnvironment` 的
 *   `SSH_AUTH_SOCK` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`
 *   （均已被上述子串族覆盖，保留显式声明以便审计）。
 *
 * 剥离方向为**保守收紧**：宁多剥（泄露面更小）不漏剥；被剥离的键不进入子进程 env。
 */

/** 具名敏感变量（精确匹配，大小写不敏感） */
const SENSITIVE_ENV_NAMES: ReadonlySet<string> = new Set([
  'SSH_AUTH_SOCK',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'GOOGLE_APPLICATION_CREDENTIALS',
]);

/** 敏感变量名子串族（大小写不敏感） */
const SENSITIVE_ENV_SUBSTRINGS: readonly string[] = [
  'PASSWORD',
  'TOKEN',
  'SECRET',
  'KEY',
  'AUTH',
  'CREDENTIAL',
];

/** 环境变量名是否敏感（应剥离，不得传入子进程） */
export function isSensitiveEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  if (SENSITIVE_ENV_NAMES.has(upper)) return true;
  return SENSITIVE_ENV_SUBSTRINGS.some((s) => upper.includes(s));
}

/**
 * **执行控制类**高风险键（第九轮审查 §五，2026-10-09）—— 影响"命令名解析 / 解释器启动 /
 * 动态库加载 / Shell 启动"，调用方（模型可控输入）**不得覆盖**。
 *
 * 与"敏感值"是**两类**：前者防**泄露**，本类防**语义改变**（命令文本不变但实际执行不同）。
 */
const EXECUTION_CONTROL_ENV_KEYS: ReadonlySet<string> = new Set([
  'PATH',
  'NODE_OPTIONS',
  'NODE_PATH',
  'PYTHONPATH',
  'PYTHONHOME',
  'PYTHONSTARTUP',
  'BASH_ENV',
  'ENV',
  'PROMPT_COMMAND',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
]);

/** 是否为执行控制类高风险键（大小写不敏感） */
export function isExecutionControlEnvKey(key: string): boolean {
  return EXECUTION_CONTROL_ENV_KEYS.has(key.toUpperCase());
}

/**
 * 清理**调用方显式传入**的 env（第九轮审查 §五 缺陷 #5 的修复）。
 *
 * 背景：`BashTool` 原为 `{ ...stripSensitiveEnv(process.env), ...(env || {}) }` —— 调用方 env
 * 在**剥离之后**合并 ⇒ 可覆盖 `PATH` / `NODE_OPTIONS` 等，甚至重新注入 `*_API_KEY`。
 *
 * 本函数对**调用方输入**施加与父进程 env **同一套**策略（敏感键）+ 额外剥离执行控制键
 * （命令文本不变但实际执行语义改变的风险）。返回 `{ env, stripped }`，`stripped` 供调用方留痕。
 */
export function sanitizeCallerEnv<T extends string | undefined>(
  env: Record<string, T>
): { env: Record<string, T>; stripped: string[] } {
  const out: Record<string, T> = {};
  const stripped: string[] = [];
  for (const key of Object.keys(env)) {
    if (isSensitiveEnvKey(key) || isExecutionControlEnvKey(key)) {
      stripped.push(key);
      continue;
    }
    out[key] = env[key];
  }
  return { env: out, stripped };
}

/**
 * 返回剥离敏感键后的新 env（不修改入参）。
 * 泛型保留 `string | undefined` 值域，兼容 `process.env` 与 `Record<string,string>`。
 */
export function stripSensitiveEnv<T extends string | undefined>(
  env: Record<string, T>
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(env)) {
    if (!isSensitiveEnvKey(key)) out[key] = env[key];
  }
  return out;
}
