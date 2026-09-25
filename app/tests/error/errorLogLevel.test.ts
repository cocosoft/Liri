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
 * 错误级别口径一致性（台账·附带发现 12）
 *
 * 修复背景：`ErrorCodes[k].level`（`CRITICAL/ERROR/WARN`，作者本意即"日志级别"）经
 * `AppError.fromCode → levelToSeverity` **折叠成 `severity` 后即丢弃**，而 `handleError`
 * 对非中止错误**硬编码 `LogLevel.ERROR`** ⇒ 声明为 `WARN` 的码（如 `ENTITY_NOT_FOUND`）
 * 在日志里永远以 error 级落盘。现由 `resolveErrorLogLevel` 单一承载该口径。
 *
 * 为什么拆成三个用例：
 *  1. 映射表本身（4 档 severity）；
 *  2. **与声明的一致性**——逐码断言 `ErrorCodes[k].level` 的意图真的落到日志级别上（若有人
 *     改了某个码的 level 或改了映射，本用例会红）；
 *  3. **反向下调防线**——未分类错误（`UNHANDLED_ERROR`）必须保持 error 级。
 *
 * 2026-09-25 追加（待办 ⑬ → 规则 R14）：
 *  4. **全表穷尽往返**（原用例 2 只是**手工抽样 8 个码** ⇒ 新增码/改错 level 无人发现）；
 *  5. **单一事实源守卫**（防"映射被内联回写、`resolveErrorLogLevel` 沦为死代码"）。
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolveErrorLogLevel } from '../../src/error/handleError';
import { AppError, ErrorSeverity } from '../../src/error/types';
import { ErrorCodes, type ErrorCodeDef } from '../../src/error/ErrorCodes';
import { LogLevel } from '../../src/monitoring/logs/Logger';

describe('错误级别口径（附带发现 12）', () => {
  it('severity → 日志级别映射（CRITICAL/HIGH→error，MEDIUM/LOW→warn）', () => {
    expect(resolveErrorLogLevel(ErrorSeverity.CRITICAL)).toBe(LogLevel.ERROR);
    expect(resolveErrorLogLevel(ErrorSeverity.HIGH)).toBe(LogLevel.ERROR);
    expect(resolveErrorLogLevel(ErrorSeverity.MEDIUM)).toBe(LogLevel.WARN);
    expect(resolveErrorLogLevel(ErrorSeverity.LOW)).toBe(LogLevel.WARN);
  });

  it('与 ErrorCodes[k].level 的声明逐码一致（口径一致性，防止单侧漂移）', () => {
    const cases: Array<[keyof typeof ErrorCodes, LogLevel]> = [
      // level: 'WARN' 的码 ⇒ 日志必须 warn（这正是本项修复的对象）
      ['ENTITY_NOT_FOUND', LogLevel.WARN],
      ['FILE_NOT_FOUND', LogLevel.WARN],
      ['INVALID_INPUT', LogLevel.WARN],
      ['NOT_IMPLEMENTED', LogLevel.WARN],
      // level: 'ERROR' 的码 ⇒ 日志必须 error（修复前后都应如此）
      ['TIMEOUT', LogLevel.ERROR],
      ['INTERNAL', LogLevel.ERROR],
      ['UNKNOWN', LogLevel.ERROR],
      ['INVALID_STATE', LogLevel.ERROR],
    ];

    for (const [name, expected] of cases) {
      const declared = ErrorCodes[name];
      const err = AppError.fromCode(declared);
      expect({
        name,
        declaredLevel: declared.level,
        logLevel: resolveErrorLogLevel(err.severity, err.code),
      }).toEqual({
        name,
        declaredLevel: declared.level,
        logLevel: expected,
      });
    }
  });

  it('未分类错误（UNHANDLED_ERROR）不下调为 warn —— 防"降噪掩盖真问题"', () => {
    // 与 handleError 包装非 AppError 的分支一致：severity=MEDIUM 且 code='UNHANDLED_ERROR'
    expect(resolveErrorLogLevel(ErrorSeverity.MEDIUM, 'UNHANDLED_ERROR')).toBe(
      LogLevel.ERROR
    );
    // 对照：同样是 MEDIUM，但来自**已声明**的 WARN 码 ⇒ 允许下调
    expect(resolveErrorLogLevel(ErrorSeverity.MEDIUM, '1005')).toBe(
      LogLevel.WARN
    );
  });

  it('全表穷尽往返：每个码声明的 level 都必须能被日志级别如实表达（R14 门禁）', () => {
    // 为什么要穷尽：上面用例 2 只覆盖 8 个**手工挑选**的码 ⇒ 新增一个码（或把某个已存在的
    // 码 level 改错）不会被任何检查发现。"表驱动断言只测样本"正是附带发现 12 得以长期隐瞒的
    // 同型原因 ⇒ 这里对 `ErrorCodes` 全表做 声明 → severity → 日志级别 的**往返**校验。
    const expectedByDeclared: Record<ErrorCodeDef['level'], LogLevel | null> = {
      CRITICAL: LogLevel.ERROR,
      ERROR: LogLevel.ERROR,
      WARN: LogLevel.WARN,
      // 当前链路**无法表达 INFO**：`ErrorSeverity` 无 INFO 档，`levelToSeverity` 对未知值走
      // `default → LOW`，再经映射落到 warn ⇒ 一旦有人真的声明 `level: 'INFO'`，**声明与落盘
      // 必然不一致**。这里留 `null` 让该情形**立即变红**，而不是静默按 warn 记（同族缺口）。
      INFO: null,
    };

    const inconsistent = Object.entries(ErrorCodes)
      .map(([name, def]) => {
        const err = AppError.fromCode(def);
        return {
          name,
          declared: def.level,
          expected: expectedByDeclared[def.level],
          actual: resolveErrorLogLevel(err.severity, err.code),
        };
      })
      .filter((row) => row.expected === null || row.expected !== row.actual);

    // 空数组 ⇒ 全表一致；失败时断言信息会**列出每一处**不一致（含声明值与实际落盘级别）
    expect(inconsistent).toEqual([]);
  });

  it('单一事实源：handleError 必须经 resolveErrorLogLevel 取级别（防映射被内联回写）', () => {
    // **如实说明本守卫的限度**：它是文本级断言 —— 只能证明"该调用点仍在"，**不能**证明
    // "仓内没有第二份内联映射"；真正的行为保证由上方往返断言承担。留着它的价值在于：
    // 若有人把映射内联进 handleError 并让 `resolveErrorLogLevel` 沦为死代码，本断言会先红。
    const source = readFileSync(
      new URL('../../src/error/handleError.ts', import.meta.url),
      'utf8'
    );
    expect(source).toContain('resolveErrorLogLevel(');
  });
});
