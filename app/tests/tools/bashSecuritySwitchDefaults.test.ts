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
 * A2 翻转（安全基线）+ 灰度治理 单元测试（第九轮审查 §七，2026-10-09）
 *
 * 覆盖：
 * - **A2** `BASH_APPROVED_REVALIDATE` 默认 = `true`（安全基线）且可灰度回退
 * - **A4/A5** 默认 = `false`（灰度）且可显式开启
 * - **§七 建议 5** 灰度告警：经「**构造 BashTool + 日志断言**」验证（**不扩大导出面**）
 *   —— 默认发一次 / 进程内只发一次 / 全开不发 / 部分关只列部分
 *
 * 治理口径（替代保护层 / 启用·回滚条件 / 迁移期限）：
 * `.trae/specs/default-off-switches-review-gates.md §2.2`。
 */

import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { feature } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import {
  BashTool,
  resetGraySwitchWarningForTest,
} from '../../src/tools/bash/BashTool.js';
import { ApprovedCommandRegistry } from '../../src/permission/ApprovedCommandRegistry.js';

const ENV_A2 = 'FEATURE_BASH_APPROVED_REVALIDATE';
const ENV_A4 = 'FEATURE_BASH_INTERPRETER_GUARD';
const ENV_A5 = 'FEATURE_BASH_APPROVAL_STRICT';

const ENV_KEYS = [ENV_A2, ENV_A4, ENV_A5] as const;
const saved = new Map<string, string | undefined>();

/** 设置开关环境变量（首次触碰时记录原值，供 afterEach 还原） */
function setEnv(key: string, value: 'true' | 'false' | null): void {
  if (!saved.has(key)) saved.set(key, process.env[key]);
  if (value === null) delete process.env[key];
  else process.env[key] = value;
}

/**
 * BashTool 使用的 logger 单例（与 `BashTool.ts` **同一字面量** ⇒ 同一实例）。
 * 注：`'tools\bash\BashTool'` 与源码一致（`\b` 为转义），故 module 名完全相同。
 */
const bashLogger = getLogger('tools\bash\BashTool');

let warnSpy: ReturnType<typeof spyOn> | undefined;

/** 记一次"灰度告警"（按消息含"灰度"过滤，避免与其它 warn 混淆） */
function grayWarnCalls(): Array<[string, unknown]> {
  const calls = (warnSpy?.mock.calls ?? []) as Array<[string, unknown]>;
  return calls.filter((c) => String(c[0]).includes('灰度'));
}

/** 构造一次 BashTool（触发一次性的灰度告警） */
function makeBashTool(): BashTool {
  return new BashTool(new ApprovedCommandRegistry(60_000, false));
}

afterEach(() => {
  warnSpy?.mockRestore();
  warnSpy = undefined;
  for (const key of ENV_KEYS) {
    const prev = saved.get(key);
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
  saved.clear();
  resetGraySwitchWarningForTest();
});

describe('A2 安全基线默认值（第九轮审查 §七 翻转）', () => {
  it('默认（无 env）⇒ BASH_APPROVED_REVALIDATE = true（安全基线）', () => {
    delete process.env[ENV_A2];
    expect(feature('BASH_APPROVED_REVALIDATE')).toBe(true);
  });

  it('灰度回退：FEATURE_BASH_APPROVED_REVALIDATE=false ⇒ false（旧行为）', () => {
    setEnv(ENV_A2, 'false');
    expect(feature('BASH_APPROVED_REVALIDATE')).toBe(false);
  });
});

describe('A4 / A5 灰度默认值（维持默认关）', () => {
  it('默认（无 env）⇒ 两者均 false', () => {
    delete process.env[ENV_A4];
    delete process.env[ENV_A5];
    expect(feature('BASH_INTERPRETER_GUARD')).toBe(false);
    expect(feature('BASH_APPROVAL_STRICT')).toBe(false);
  });

  it('可显式开启（=true）', () => {
    setEnv(ENV_A4, 'true');
    setEnv(ENV_A5, 'true');
    expect(feature('BASH_INTERPRETER_GUARD')).toBe(true);
    expect(feature('BASH_APPROVAL_STRICT')).toBe(true);
  });
});

describe('§七 建议 5：灰度开关告警（不长期无告警默认关）', () => {
  it('默认（A4/A5 关）⇒ 构造 BashTool 发一次告警且列出两个灰度开关', () => {
    delete process.env[ENV_A4];
    delete process.env[ENV_A5];
    warnSpy = spyOn(bashLogger, 'warn');
    makeBashTool();

    const calls = grayWarnCalls();
    expect(calls.length).toBe(1);
    const meta = calls[0][1] as { switches?: string[] };
    expect(meta.switches?.sort()).toEqual(
      ['BASH_INTERPRETER_GUARD', 'BASH_APPROVAL_STRICT'].sort()
    );
  });

  it('进程内只发一次（连续构造两次 ⇒ 累计仍 1 次）', () => {
    delete process.env[ENV_A4];
    delete process.env[ENV_A5];
    warnSpy = spyOn(bashLogger, 'warn');
    makeBashTool();
    makeBashTool();
    expect(grayWarnCalls().length).toBe(1);
  });

  it('A4/A5 均开启 ⇒ 不告警（无灰度项）', () => {
    setEnv(ENV_A4, 'true');
    setEnv(ENV_A5, 'true');
    warnSpy = spyOn(bashLogger, 'warn');
    makeBashTool();
    expect(grayWarnCalls().length).toBe(0);
  });

  it('仅 A5 关闭 ⇒ 告警只列出 A5', () => {
    setEnv(ENV_A4, 'true');
    setEnv(ENV_A5, 'false');
    warnSpy = spyOn(bashLogger, 'warn');
    makeBashTool();

    const calls = grayWarnCalls();
    expect(calls.length).toBe(1);
    const meta = calls[0][1] as { switches?: string[] };
    expect(meta.switches).toEqual(['BASH_APPROVAL_STRICT']);
  });
});
