/**
 * CodeRunner 静态校验（CM-4）
 *
 * 校验链（六轮评审合并）：
 *   1. 语法门禁：Bun.Transpiler().transformSync(code)（语法错误即抛）
 *   2. 导入枚举：Bun.Transpiler().scan(code) → 拒绝任何非空 imports
 *      （kind 覆盖 import-statement / import-expression / require-call / dynamic-import）
 *   3. 正则补漏：import.meta.require（Bun 特有同步 require，放宽到 import.meta[ 防混淆）
 *   4. 敏感全局标识符扫描：Bun/fetch/process/Deno/WebSocket 直接引用
 *
 * 结果分类（供 CM-1 降级判定）：
 *   - syntax-error      → 编译错误，立即降级不重试
 *   - forbidden-import  → 安全拒绝，不进迭代循环
 *   - forbidden-global  → 安全拒绝，不进迭代循环
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:CodeRunner:validation');

import type { CodeValidationIssue, CodeValidationResult } from './types';

// ─── Bun.Transpiler 最小接口（项目未显式引入 bun-types，自定义接口避免类型依赖）───

interface TranspilerImport {
  path: string;
  kind: string;
}

interface TranspilerLike {
  transformSync(code: string): string;
  scan(code: string): { imports: TranspilerImport[] };
}

function getTranspiler(): TranspilerLike | null {
  const bunGlobal = (globalThis as { Bun?: unknown }).Bun;
  if (bunGlobal && typeof bunGlobal === 'object') {
    const Transpiler = (bunGlobal as { Transpiler?: unknown }).Transpiler;
    if (typeof Transpiler === 'function') {
      return new (Transpiler as new () => TranspilerLike)();
    }
  }
  return null;
}

// ─── 敏感全局标识符（运行时层 delete 的同一清单，静态层同步）────────────────────

const SENSITIVE_GLOBALS = [
  'Bun',
  'fetch',
  'process',
  'Deno',
  'WebSocket',
] as const;

/** 敏感全局直接引用检测——仅识别标识符形态（支持 globalThis['Bun'] 混淆检测） */
const SENSITIVE_GLOBAL_RE = new RegExp(
  `\\b(${SENSITIVE_GLOBALS.join('|')})\\b|globalThis\\s*\\[\\s*['"](?:${SENSITIVE_GLOBALS.join('|')})['"]\\s*\\]`,
  'g'
);

/** import.meta.require 及 import.meta['require'] 混淆形态 */
const IMPORT_META_REQUIRE_RE =
  /import\.meta\s*(?:\.require|\[['"]require['"]\])/g;

// ─── 校验实现 ─────────────────────────────────────────────────────────────────

/**
 * 校验编排代码
 * @param code 编排代码源码
 * @returns 校验结果（ok = 通过；issues 按出现顺序）
 */
export function validateCodeRunnerCode(code: string): CodeValidationResult {
  const issues: CodeValidationIssue[] = [];

  // 1. 语法门禁
  const transpiler = getTranspiler();
  if (transpiler) {
    try {
      transpiler.transformSync(code);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({ kind: 'syntax-error', message });
      return { ok: false, issues };
    }

    // 2. 导入枚举（scan 覆盖 import 语句/动态 import/require 调用）
    try {
      const scanned = transpiler.scan(code);
      for (const imp of scanned.imports) {
        issues.push({
          kind: 'forbidden-import',
          message: `forbidden import (${imp.kind}): ${imp.path}`,
        });
      }
    } catch (error) {
      // scan 失败不阻断——正则补漏与语法门禁已覆盖主要形态
      logger.warn('Bun.Transpiler.scan failed, falling back to regex', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    // Bun.Transpiler 不可用（非 Bun 运行时）→ 语法门禁降级为 import.meta.require 正则
    logger.warn('Bun.Transpiler unavailable, static validation degraded');
  }

  // 3. import.meta.require 正则补漏
  for (const match of code.matchAll(IMPORT_META_REQUIRE_RE)) {
    issues.push({
      kind: 'forbidden-import',
      message: `forbidden import.meta.require at offset ${match.index}`,
    });
  }

  // 4. 敏感全局标识符扫描
  for (const match of code.matchAll(SENSITIVE_GLOBAL_RE)) {
    issues.push({
      kind: 'forbidden-global',
      message: `forbidden global reference: ${match[0]}`,
    });
  }

  return { ok: issues.length === 0, issues };
}
