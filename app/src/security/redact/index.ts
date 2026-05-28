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
export { SensitiveDataRedactor } from './SensitiveDataRedactor';
export type { RedactStats } from './SensitiveDataRedactor';
