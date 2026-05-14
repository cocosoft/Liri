/**
 * 运行时脱敏模块导出
 * 对标 Hermes agent/redact.py
 */
export {
  RuntimeRedactEngine,
  createRuntimeRedactEngine,
} from './RuntimeRedactEngine';
export type { RedactResult, ObjectRedactResult } from './RuntimeRedactEngine';
export {
  RedactConfigManager,
  loadRedactConfigFromEnv,
  DEFAULT_REDACT_CONFIG,
} from './RedactConfig';
export type { RedactConfig, RedactMode } from './RedactConfig';
export {
  RedactMiddleware,
  getRedactMiddleware,
  resetRedactMiddleware,
} from './RedactMiddleware';
export {
  SENSITIVE_KEY_PATTERNS,
  SENSITIVE_BODY_PATTERNS,
  SHORT_TOKEN_MIN_LENGTH,
  LONG_TOKEN_PREFIX_CHARS,
  LONG_TOKEN_SUFFIX_CHARS,
  NUMERIC_SENSITIVE_PATTERNS,
  EMAIL_PATTERN,
  REDACTED_PLACEHOLDER,
  REDACTED_CONTEXT_PLACEHOLDER,
} from './RedactPatterns';
