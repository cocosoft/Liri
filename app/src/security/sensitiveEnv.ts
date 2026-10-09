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
