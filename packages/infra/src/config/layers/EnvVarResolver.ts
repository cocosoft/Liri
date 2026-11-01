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

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

/**
 * ${ENV_VAR} 变量替换（11.4 规范落地）：
 * - 语法：`${VAR}` 或 `${VAR:-default}`（缺失时用默认值）；
 * - 缺失变量且无默认值 → fail-fast（防止生产悄悄用空值）；
 * - 转义：`$${` → 字面 `${`（不替换）；
 * - 替换时机：每层加载后立即替换（11.4），避免跨层残留未解析引用。
 */

export interface EnvVarResolveOptions {
  /** 环境变量来源（默认 process.env） */
  env?: Record<string, string | undefined>;
  /** 缺失变量是否抛错（默认 true = fail-fast） */
  failFast?: boolean;
}

/** 解析单个字符串中的 ${VAR} / ${VAR:-default}（支持 $${ 转义） */
export function resolveEnvString(
  value: string,
  env: Record<string, string | undefined>,
  failFast: boolean
): string {
  let result = '';
  let i = 0;
  while (i < value.length) {
    const dollar = value.indexOf('$', i);
    if (dollar === -1) {
      result += value.slice(i);
      break;
    }
    // 转义：$${ → 字面 ${
    if (value[dollar + 1] === '$' && value[dollar + 2] === '{') {
      result += value.slice(i, dollar + 1) + '{';
      i = dollar + 3;
      continue;
    }
    if (value[dollar + 1] === '{') {
      const close = value.indexOf('}', dollar);
      if (close === -1) {
        // 未闭合：字面保留
        result += value.slice(i, dollar + 1);
        i = dollar + 1;
        continue;
      }
      result += value.slice(i, dollar);
      const expr = value.slice(dollar + 2, close);
      const colonIdx = expr.indexOf(':-');
      const varName = colonIdx === -1 ? expr : expr.slice(0, colonIdx);
      const defVal = colonIdx === -1 ? undefined : expr.slice(colonIdx + 2);
      const v = env[varName];
      if (v !== undefined) {
        result += v;
      } else if (defVal !== undefined) {
        result += defVal;
      } else if (failFast) {
        throw new AppError(
          `环境变量缺失且无默认值: ${varName}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      } else {
        // fail-open：保留原文
        result += value.slice(dollar, close + 1);
      }
      i = close + 1;
      continue;
    }
    // 普通 $ 字面
    result += value.slice(i, dollar + 1);
    i = dollar + 1;
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 递归替换配置对象中的所有字符串值（不可变，返回新对象）。
 */
export function resolveEnvVars(
  config: Record<string, unknown>,
  opts: EnvVarResolveOptions = {}
): Record<string, unknown> {
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const failFast = opts.failFast ?? true;

  const walk = (node: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string') {
        out[key] = resolveEnvString(value, env, failFast);
      } else if (isPlainObject(value)) {
        out[key] = walk(value);
      } else if (Array.isArray(value)) {
        out[key] = value.map((item) =>
          typeof item === 'string'
            ? resolveEnvString(item, env, failFast)
            : isPlainObject(item)
              ? walk(item)
              : item
        );
      } else {
        out[key] = value;
      }
    }
    return out;
  };

  return walk(config);
}
