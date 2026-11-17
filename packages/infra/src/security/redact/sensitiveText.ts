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
 * 命令 / 文本的**落盘前去敏**（R4，2026-11-17；治理方案 §4.1 / §11.6-⑦）
 *
 * 唯一出口：采样（`unknownCommandSamples`）与审批预览（`inputPreview`）共用本函数
 * ⇒ 两处口径不可能漂移（CS01：不另建第二套"秘密形态"规则）。
 *
 * 分四层，顺序不可调换：
 * 1. **既有秘密形态表**（`redactSecretsFully`：sk- / ghp_ / AKIA / Bearer / 连接串 …）；
 * 2. **键值型凭据**（`--password=…` / `TOKEN: …` / `"apiKey":"…"`）；
 * 3. **URL 内嵌凭据**（`https://user:pass@host` ⇒ `https://[REDACTED]@host`）；
 * 4. **疑似长 hex / base64 截断**（保留前 8 字符 + 长度，便于评审判断"是不是随机载荷"）。
 *
 * 只做文本替换，不判定、不阻断；调用方负责截断与落盘。
 */
import { redactSecretsFully } from '../scanner/secret/index.js';

/** 统一占位符（与 `redactSecretsFully` 默认值一致） */
export const SENSITIVE_TEXT_PLACEHOLDER = '[REDACTED]';

/** 长随机串的截断长度门槛（hex 以字符数计；base64 同） */
export const LONG_RANDOM_TOKEN_MIN_LENGTH = 32;

/** 截断后保留的可见前缀长度（足以看出"是随机串"而不是语义内容） */
const TRUNCATED_PREFIX_CHARS = 8;

/**
 * 键值型凭据：`token=…` / `--password=…` / `"secret": "…"` / `Authorization: …`。
 *
 * 保留键名（评审需要知道"哪个参数泄了"），只替换值。
 */
const KEY_VALUE_SECRET_PATTERN =
  /\b(token|secret|password|passwd|pwd|authorization|api[_-]?key|access[_-]?key|secret[_-]?key|auth[_-]?key|credentials?|key)["']?\s*[:=]\s*["']?[^\s"',;]+/gi;

/** URL 内嵌凭据：`scheme://user:pass@host` */
const URL_CREDENTIAL_PATTERN =
  /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi;

/** 疑似长 hex（32+） */
const LONG_HEX_PATTERN = /\b[0-9a-f]{32,}\b/gi;

/** 疑似长 base64（40+，允许 `+` `/` 与尾部 `=`） */
const LONG_BASE64_PATTERN = /\b[A-Za-z0-9+/]{40,}={0,2}\b/g;

export interface SensitiveTextRedactResult {
  /** 脱敏后的文本 */
  text: string;
  /** 是否发生替换（CS02：结构化信号，不靠文案比对） */
  hit: boolean;
}

/** 截断长随机串：保留前缀 + 长度（不整段删除，评审需要判断形态） */
function truncateRandomToken(match: string): string {
  if (match.length < LONG_RANDOM_TOKEN_MIN_LENGTH) return match;
  return `${match.slice(0, TRUNCATED_PREFIX_CHARS)}…(${match.length})`;
}

/**
 * 文本去敏（纯函数）。
 *
 * @param text 待脱敏文本（命令原文 / JSON 预览）
 * @param placeholder 占位符（默认 `[REDACTED]`）
 */
export function redactSensitiveText(
  text: string,
  placeholder: string = SENSITIVE_TEXT_PLACEHOLDER
): SensitiveTextRedactResult {
  if (!text) return { text, hit: false };

  let out = redactSecretsFully(text, placeholder).text;

  out = out.replace(
    KEY_VALUE_SECRET_PATTERN,
    (match, key: string) => `${key}=${placeholder}`
  );
  out = out.replace(URL_CREDENTIAL_PATTERN, `$1${placeholder}@`);
  out = out.replace(LONG_HEX_PATTERN, (match) => truncateRandomToken(match));
  out = out.replace(LONG_BASE64_PATTERN, (match) =>
    truncateRandomToken(match)
  );

  return { text: out, hit: out !== text };
}

/** 预览脱敏的输入规模上限：超过即"先截断再脱敏"（避免对超大正文做全量正则扫描） */
const PREVIEW_REDACT_FULL_INPUT_MAX_CHARS = 32_768;

/**
 * 审批卡 / 审计的**入参预览**（脱敏 + 截断）。
 *
 * 小输入（≤32 KB）先整体脱敏再截断（防止密钥被截断后逃过模式匹配）；
 * 超大输入（文件正文等）先截断再脱敏 —— 预览本就不该展示整段正文。
 */
export function buildRedactedInputPreview(
  input: unknown,
  maxChars: number
): string {
  const json = JSON.stringify(input) ?? '';
  if (json.length <= PREVIEW_REDACT_FULL_INPUT_MAX_CHARS) {
    return redactSensitiveText(json).text.slice(0, maxChars);
  }
  return redactSensitiveText(json.slice(0, maxChars)).text.slice(0, maxChars);
}
