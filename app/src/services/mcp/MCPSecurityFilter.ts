/**
 * MCPSecurityFilter — MCP 凭据剥离与安全环境构建
 *
 * P2-4: 对标 hermes-agent _CREDENTIAL_PATTERN + _build_safe_env
 * 防止 API keys、tokens、密码等敏感信息通过 MCP 错误消息泄露到 LLM 上下文。
 *
 * 两条防线：
 *   1. _CREDENTIAL_PATTERN — 从错误消息/输出中正则剥离凭据
 *   2. _build_safe_env — 仅允许安全基线的环境变量传递给 MCP 子进程
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('mcp:securityFilter');

// ==========================================
// P2-4: 凭据剥离
// ==========================================

/** 凭据剥离正则模式列表 */
const CREDENTIAL_PATTERNS: Array<{
  pattern: RegExp;
  name: string;
  replacement: string;
}> = [
  // GitHub tokens
  {
    pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g,
    name: 'github_token',
    replacement: '[REDACTED:github_token]',
  },
  // OpenAI/Anthropic API keys
  {
    pattern: /sk-(?:ant|proj)-[A-Za-z0-9_-]{32,}/g,
    name: 'api_key',
    replacement: '[REDACTED:api_key]',
  },
  // Generic Bearer tokens
  {
    pattern: /bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
    name: 'bearer_token',
    replacement: 'Bearer [REDACTED]',
  },
  // AWS access keys
  {
    pattern: /AKIA[0-9A-Z]{16}/g,
    name: 'aws_key',
    replacement: '[REDACTED:aws_key]',
  },
  // Generic hex/api keys (32+ chars)
  {
    pattern: /[A-Za-z0-9+/]{52,}={0,2}/g,
    name: 'long_base64',
    replacement: '[REDACTED:long_token]',
  },
  // JWT tokens (header.body.signature)
  {
    pattern: /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g,
    name: 'jwt',
    replacement: '[REDACTED:jwt]',
  },
  // Private key headers
  {
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    name: 'private_key',
    replacement: '[REDACTED:private_key]',
  },
];

/**
 * 从文本中剥离凭据
 * @returns { cleaned, redactedCount, detectedTypes }
 */
export function stripCredentials(text: string): {
  cleaned: string;
  redactedCount: number;
  detectedTypes: string[];
} {
  if (!text) return { cleaned: text, redactedCount: 0, detectedTypes: [] };

  let cleaned = text;
  let redactedCount = 0;
  const detectedTypes: string[] = [];

  for (const { pattern, name, replacement } of CREDENTIAL_PATTERNS) {
    const match = cleaned.match(pattern);
    if (match) {
      redactedCount += match.length;
      detectedTypes.push(name);
      cleaned = cleaned.replace(pattern, replacement);
    }
  }

  if (redactedCount > 0) {
    logger.info('mcp:credentials_stripped', {
      redactedCount,
      detectedTypes: [...new Set(detectedTypes)],
    });
  }

  return { cleaned, redactedCount, detectedTypes };
}

// ==========================================
// P2-4: 安全环境变量构建
// ==========================================

/** 允许传递给 MCP 子进程的安全基线环境变量 */
const SAFE_ENV_KEYS = new Set([
  // OS required
  'PATH',
  'HOME',
  'USER',
  'TEMP',
  'TMP',
  'TMPDIR',
  'SHELL',
  'LANG',
  'LC_ALL',
  'TERM',
  // XDG paths
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'XDG_RUNTIME_DIR',
  // PY_APP specific (non-sensitive)
  'LIRI_HOME',
  'LIRI_DATA_DIR',
  'LIRI_PROJECT_DIR',
  'OUTPUT_DIR',
  'DOWNLOADS_DIR',
  // System info
  'OS',
  'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS',
  // Bun/Node
  'NODE_ENV',
  'BUN_INSTALL',
  'npm_config_cache',
  // Display
  'DISPLAY',
  'WAYLAND_DISPLAY',
]);

/** 明确拒绝的环境变量键（含敏感信息） */
const BLOCKED_ENV_PATTERNS = [
  /API[_-]?KEY/i,
  /TOKEN/i,
  /SECRET/i,
  /PASSWORD/i,
  /PASSWD/i,
  /CREDENTIAL/i,
  /PRIVATE[_-]?KEY/i,
  /AUTH/i,
  /ACCESS[_-]?KEY/i,
  /DATABASE_URL/i,
  /DB_[A-Z]/i,
  /REDIS_URL/i,
];

/**
 * 构建安全的环境变量传递集合
 * 仅包含 SAFE_ENV_KEYS 白名单 + 用户显式指定的额外键
 */
export function buildSafeEnv(extraKeys?: string[]): Record<string, string> {
  const safe: Record<string, string> = {};

  const allowedKeys = new Set(SAFE_ENV_KEYS);
  if (extraKeys) {
    for (const key of extraKeys) {
      const blocked = BLOCKED_ENV_PATTERNS.some((p) => p.test(key));
      if (!blocked) {
        allowedKeys.add(key);
      } else {
        logger.warn('mcp:env_blocked', {
          key,
          reason: 'matched blocked pattern',
        });
      }
    }
  }

  for (const key of allowedKeys) {
    const value = process.env[key];
    if (value !== undefined) {
      safe[key] = value;
    }
  }

  return safe;
}

/**
 * 审计**显式配置**的 env（MCP server 自身配置），在合并进子进程环境前给出告警。
 *
 * 与 `buildSafeEnv()` 的分工（2026-10-12，G-2 收紧）：
 * - `buildSafeEnv()` 约束的是「从**宿主** `process.env` 白名单继承」——不得全量继承；
 * - 本函数处理的是**用户显式写在 MCP 配置里的 env**：这是为 MCP server 提供其**自身凭据**的
 *   标准用法（如 `GITHUB_PERSONAL_ACCESS_TOKEN`），故**不按名硬拦截**（硬拦会破坏正常接入），
 *   但必须**显式审计**：命中敏感名 ⇒ 告警；若其值恰与同名宿主变量一致 ⇒ 追加高信号告警，
 *   以暴露「误把宿主密钥抄进配置」的情况。**告警只含键名，绝不含值。**
 */
export function auditExplicitEnv(
  env?: Record<string, string>
): Record<string, string> {
  if (!env) return {};

  const sensitiveKeys = Object.keys(env).filter((key) =>
    BLOCKED_ENV_PATTERNS.some((p) => p.test(key))
  );
  if (sensitiveKeys.length === 0) return env;

  logger.warn('mcp:explicit_env_sensitive', {
    keys: sensitiveKeys,
    note: 'explicit MCP server env contains sensitive-named keys; forwarded by design (server-owned credentials)',
  });

  const hostCopiedKeys = sensitiveKeys.filter(
    (key) => process.env[key] !== undefined && process.env[key] === env[key]
  );
  if (hostCopiedKeys.length > 0) {
    logger.warn('mcp:explicit_env_value_from_host', {
      keys: hostCopiedKeys,
      note: 'explicit MCP env value equals the host env value — confirm this is intended, not an accidental copy',
    });
  }

  return env;
}

/**
 * 对 MCP 返回的**结构化载荷**做凭据剥离（JSON 往返）。
 * 与 `MCPServerManager.callTool` 的对象分支同源（CS01：单一实现，勿再各写一份）。
 * 脱敏后若无法解析回 JSON，退回脱敏后的字符串（安全过滤容错，不抛错）。
 */
export function redactMcpPayload<T>(value: T): T | string {
  try {
    const jsonStr = JSON.stringify(value);
    if (jsonStr === undefined) return value;
    const { cleaned } = stripCredentials(jsonStr);
    if (cleaned === jsonStr) return value;
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      return cleaned;
    }
  } catch {
    return value;
  }
}

/**
 * 过滤 MCP 工具结果，应用凭据剥离
 */
export function filterMCPToolResult(output: string): string {
  const { cleaned, redactedCount } = stripCredentials(output);
  if (redactedCount > 0) {
    return `${cleaned}\n\n[System note: ${redactedCount} credential(s) were redacted from this output for security.]`;
  }
  return cleaned;
}
