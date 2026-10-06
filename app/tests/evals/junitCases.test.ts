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

import { describe, expect, it } from 'bun:test';
import { junitCaseKey, parseJunitCases } from '../../src/evals/repoTestJudge';

/**
 * A2（`.trae/specs/eval-s1-real-task-baseline.md`）T1：逐用例 JUnit 解析。
 *
 * XML 片段**取自 2026-10-06 的真实 `bun test --reporter=junit` 输出形态**
 * （通过=自闭合；失败=带 `<failure>` 子元素；跳过=带 `<skipped>`）。
 */
describe('parseJunitCases（A2/T1）', () => {
  const xmlWithFail = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="2" assertions="2" failures="1" skipped="0" time="0.5">
  <testsuite name="probe" file="tests\\probe.test.ts" tests="2" failures="1">
    <testcase name="passes" classname="probe" time="0.0001" file="tests\\probe.test.ts" line="4" />
    <testcase name="fails" classname="probe" time="0.0004" file="tests\\probe.test.ts" line="7">
      <failure type="AssertionError" message="expect(received).toBe(expected)&#10;Expected: 2">AssertionError</failure>
    </testcase>
  </testsuite>
</testsuites>`;

  it('混合：识别 passes / fails 各自的 status', () => {
    const cases = parseJunitCases(xmlWithFail);

    expect(cases).not.toBeNull();
    expect(cases!.map((c) => [c.name, c.status])).toEqual([
      ['passes', 'passed'],
      ['fails', 'failed'],
    ]);
  });

  it('属性解析：classname / file（反斜杠归一为 /）', () => {
    const cases = parseJunitCases(xmlWithFail)!;

    expect(cases[0].classname).toBe('probe');
    expect(cases[0].file).toBe('tests/probe.test.ts');
  });

  it('skipped 与 passed **必须区分**（否则 skip 会被误当 P2P）', () => {
    const xml = `<testsuites name="bun test" tests="2" failures="0">
  <testsuite name="s" file="a/t.test.ts" tests="2" failures="0">
    <testcase name="ok" classname="s" file="a/t.test.ts" />
    <testcase name="lazy" classname="s" file="a/t.test.ts"><skipped /></testcase>
  </testsuite>
</testsuites>`;

    const cases = parseJunitCases(xml)!;

    expect(cases.map((c) => c.status)).toEqual(['passed', 'skipped']);
  });

  it('实体解码：名称中的 &amp; / &#10; 被还原', () => {
    const xml = `<testsuites name="bun test" tests="1" failures="0">
  <testsuite name="s" file="a/t.test.ts" tests="1" failures="0">
    <testcase name="a &amp; b&#10;c" classname="s" file="a/t.test.ts" />
  </testsuite>
</testsuites>`;

    expect(parseJunitCases(xml)![0].name).toBe('a & b\nc');
  });

  // ── fail-closed 边界（三条一律 null，**不**猜测推断） ─────────────────
  it('报告缺失（null）⇒ null', () => {
    expect(parseJunitCases(null)).toBeNull();
  });

  it('结构不符（无 <testsuites> 头）⇒ null', () => {
    expect(parseJunitCases('<html>not a junit report</html>')).toBeNull();
  });

  it('空用例集（有头但零 <testcase>）⇒ null', () => {
    expect(
      parseJunitCases('<testsuites name="bun test" tests="0" failures="0" />')
    ).toBeNull();
  });

  describe('junitCaseKey（跨 start/fixed 两次运行可比）', () => {
    it('file::classname::name；file 缺失时退化为 classname::name', () => {
      expect(
        junitCaseKey({
          name: 'ok',
          classname: 's',
          file: 'a/t.test.ts',
          status: 'passed',
        })
      ).toBe('a/t.test.ts::s::ok');

      expect(
        junitCaseKey({
          name: 'ok',
          classname: 's',
          file: '',
          status: 'passed',
        })
      ).toBe('s::ok');
    });
  });
});
