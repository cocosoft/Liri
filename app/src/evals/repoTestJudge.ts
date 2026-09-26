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
 * S1 题目判据：**跑真实测试，并把"红"分层**。
 *
 * ⚠️ **为什么要分层**（2026-09-26 实测，spec §4.5）：只看退出码会把两种完全不同的情形混为一谈 ——
 *
 * | 情形 | exit | JUnit 报告 | 含义 |
 * |---|---|---|---|
 * | 断言失败 | 1 | **有**（`failures>0`，含 `<failure type="AssertionError"/>`） | **真红**（起始态该有的样子） |
 * | 源文件缺模块 | 1 | **不生成**（bun 在写报告前崩溃） | 快照**跑不起来** ⇒ 必须拒绝 |
 * | 源文件语法错误 | 1 | **不生成** | 同上 |
 *
 * 若把"跑不起来"当成"起始态必失败" ⇒ 坏题被静默放行（这与 A7 的桩生成缺陷**同型**）。
 * 故判据一律走**机器可读**的 JUnit 报告（CS02：不做日志文案匹配）。
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** 一次测试运行的三态判定 */
export type RepoTestVerdict = 'green' | 'red' | 'unrunnable';

export interface JunitSummary {
  tests: number;
  failures: number;
}

/**
 * 解析 `bun test --reporter=junit` 的 `<testsuites>` 头（**按属性名取**，不依赖属性顺序）。
 * 报告缺失 / 结构不符 ⇒ `null`（调用方须按 fail-closed 处理）。
 */
export function parseJunitSummary(xml: string | null): JunitSummary | null {
  if (xml === null) return null;
  const tag = /<testsuites\b[^>]*>/.exec(xml)?.[0];
  if (!tag) return null;
  const num = (name: string): number | null => {
    const m = new RegExp(`${name}="(\\d+)"`).exec(tag);
    return m ? Number(m[1]) : null;
  };
  const tests = num('tests');
  const failures = num('failures');
  if (tests === null || failures === null) return null;
  return { tests, failures };
}

/**
 * 三态判定（**纯函数**，可离线断言）。
 *
 * - 无报告 / 零用例 / 非零退出但**无断言失败** ⇒ `unrunnable`（fail-closed：无法归因于断言就不认作"红"）
 * - `failures > 0` ⇒ `red`（真红）
 * - 其余（退出 0 且有用例） ⇒ `green`
 */
export function classifyRepoTestRun(input: {
  exitCode: number;
  junitXml: string | null;
}): RepoTestVerdict {
  const summary = parseJunitSummary(input.junitXml);
  if (summary === null) return 'unrunnable';
  if (summary.tests === 0) return 'unrunnable';
  if (summary.failures > 0) return 'red';
  if (input.exitCode !== 0) return 'unrunnable';
  return 'green';
}

/**
 * 在快照的 `app` 目录里跑指定测试文件（真实子进程 + JUnit 报告）。
 *
 * 用 `process.execPath`（= 当前 bun）以避开 PATH 差异；**不经宿主 shell**。
 */
export async function runRepoTest(args: {
  appDir: string;
  testPaths: readonly string[];
  timeoutMs?: number;
}): Promise<{
  verdict: RepoTestVerdict;
  exitCode: number;
  summary: JunitSummary | null;
  detail: string;
}> {
  const outDir = mkdtempSync(join(tmpdir(), 'liri-s1-junit-'));
  const junitPath = join(outDir, 'report.xml');
  let exitCode = 0;

  try {
    await execFileAsync(
      process.execPath,
      [
        'test',
        ...args.testPaths,
        '--reporter=junit',
        `--reporter-outfile=${junitPath}`,
      ],
      {
        cwd: args.appDir,
        timeout: args.timeoutMs ?? 300_000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        encoding: 'utf-8',
      }
    );
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    exitCode = typeof code === 'number' ? code : 1;
  }

  const junitXml = existsSync(junitPath)
    ? readFileSync(junitPath, 'utf-8')
    : null;
  rmSync(outDir, { recursive: true, force: true });

  const summary = parseJunitSummary(junitXml);
  return {
    verdict: classifyRepoTestRun({ exitCode, junitXml }),
    exitCode,
    summary,
    detail: summary
      ? `tests=${summary.tests} failures=${summary.failures} exit=${exitCode}`
      : `无 JUnit 报告（加载/解析期失败）exit=${exitCode}`,
  };
}

/**
 * S1 题目的**准入判据**（纯函数）：起始态必须**真红**、修复态必须**绿**。
 *
 * 任一不成立 ⇒ 拒绝并给出可读原因（fail-closed；理由写进错误信息，遵循"把出路写进错误"的既有取向）。
 */
export function judgeS1Eligibility(input: {
  startVerdict: RepoTestVerdict;
  fixedVerdict: RepoTestVerdict;
}): { eligible: boolean; reason?: string } {
  if (input.startVerdict === 'unrunnable') {
    return {
      eligible: false,
      reason:
        '起始态快照不可运行（加载/解析失败或未发现用例）⇒ 拒绝：' +
        '不得把"跑不起来"当成"起始态必失败"',
    };
  }
  if (input.startVerdict === 'green') {
    return {
      eligible: false,
      reason: '起始态已通过测试 ⇒ 题目零区分度 ⇒ 拒绝',
    };
  }
  if (input.fixedVerdict !== 'green') {
    return {
      eligible: false,
      reason: `修复态未通过（verdict=${input.fixedVerdict}）⇒ 判据与该修复不匹配 ⇒ 拒绝`,
    };
  }
  return { eligible: true };
}
