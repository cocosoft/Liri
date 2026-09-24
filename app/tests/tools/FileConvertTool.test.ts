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
 * `file_convert`（target_format=md）取回能力测试（2026-09-24，台账 N-54 缺口 G-A/G-B）
 *
 * 实机故障：64 页 PDF → MD 转换输出 316,225 字符，被工具结果上限（30,000）"头尾截断"
 * 后模型只拿到 30,026 字符，且**既没有 offset/limit 可调、返回体也没有取回指引**
 * ⇒ 模型只能自建 python/pdfplumber 外部脚本绕行（`session_mue7udf5ejdjwcvlfw`）。
 *
 * 本文件锁定修复后的契约：
 *   G-A  入参暴露 offset/limit（与 `file_read` 行语义一致）⇒ 可分段取回中段；
 *   G-B  被截断时给出「总规模 + 可执行的取回指引」；分段模式**按上限收敛到整行**，
 *        绝不返回半截段（真实 PDF 各页长度差异极大，让模型猜 limit 会白跑一轮）。
 */
import { describe, expect, test } from 'bun:test';
import {
  FileConvertTool,
  shapeMarkdownResult,
} from '../../src/tools/FileConvertTool/FileConvertTool';
import { MAX_TOOL_RESULT_CHARS } from '@modules/query';

const FILE = 'C:\\tmp\\paper.pdf';
const HEAD = 'H'.repeat(20_000);
const MID = 'M'.repeat(20_000);
const TAIL = 'T'.repeat(20_000);
/** 3 行 × 20,000 字符（+2 个换行）= 60,002 字符 ⇒ 必然超过 30,000 上限 */
const FULL = [HEAD, MID, TAIL].join('\n');

describe('file_convert — G-A：入参暴露 offset/limit', () => {
  test('params 含 offset / limit（修复前不存在 ⇒ 本用例在修复前必失败）', () => {
    const names = new FileConvertTool().params.map((p) => p.name);
    expect(names).toContain('offset');
    expect(names).toContain('limit');
  });

  test('offset=2&limit=1 ⇒ 取回完整中段（不再被截断、正文逐字相等）', () => {
    const r = shapeMarkdownResult(FULL, FILE, 2, 1);
    expect(r.markdown).toBe(MID);
    expect(r.markdown).not.toContain('字符已截断');
    expect(r.message).toContain('第 2-2 行');
    expect(r.message).toContain('offset=3');
  });

  test('末段 limit 超出剩余行数 ⇒ 收敛到末行且不再提示继续', () => {
    const r = shapeMarkdownResult(FULL, FILE, 3, 99);
    expect(r.markdown).toBe(TAIL);
    expect(r.message).toContain('第 3-3 行');
    expect(r.message).not.toContain('读取后续段落');
  });
});

describe('file_convert — G-B：截断时给出总规模与可执行的取回指引', () => {
  test('未指定 offset/limit 且超限 ⇒ 截断 + 指引含总行数/总字符/取回方式', () => {
    const r = shapeMarkdownResult(FULL, FILE);
    expect(r.markdown).toContain('字符已截断');
    expect(r.message).toContain('共 3 行');
    expect(r.message).toContain(`${FULL.length} 字符`);
    expect(r.message).toContain('offset/limit');
    expect(r.message).toContain('offset=1');
  });

  test('limit 过大 ⇒ 按上限自动收敛，绝不返回半截段（游标可续）', () => {
    const r = shapeMarkdownResult(FULL, FILE, 1, 999);
    expect(r.markdown).not.toContain('字符已截断');
    expect(r.markdown.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
    const end = Number(r.message.match(/第 1-(\d+) 行/)?.[1]);
    const next = Number(r.message.match(/offset=(\d+)/)?.[1]);
    expect(end).toBe(1);
    expect(next).toBe(end + 1);
  });

  test('单行本身超上限 ⇒ 返回该行（截断）并注明，不原地空转', () => {
    const twoLines = ['X'.repeat(40_000), 'tail'].join('\n');
    const r = shapeMarkdownResult(twoLines, FILE, 1, 1);
    expect(r.markdown).toContain('字符已截断');
    expect(r.message).toContain('单行超过上限');
    expect(r.message).toContain('offset=2');
  });

  test('沿 offset 游标可走完全文（分段拼接逐字等于原文）', () => {
    const doc = [
      'p1-' + 'a'.repeat(12_000),
      '',
      'p2-' + 'b'.repeat(14_000),
      '',
      'p3-' + 'c'.repeat(9_000),
    ].join('\n');
    const totalLines = doc.split('\n').length;
    const got: string[] = [];
    let offset = 1;
    for (let guard = 0; guard < 50 && offset <= totalLines; guard++) {
      const r = shapeMarkdownResult(doc, FILE, offset, 999);
      expect(r.markdown).not.toContain('字符已截断');
      got.push(r.markdown);
      const next = r.message.match(/offset=(\d+)/);
      if (!next) break;
      offset = Number(next[1]);
    }
    expect(got.join('\n')).toBe(doc);
  });

  test('offset 超出范围 ⇒ 明示无内容返回，不静默给空', () => {
    const r = shapeMarkdownResult(FULL, FILE, 10, 1);
    expect(r.markdown).toBe('');
    expect(r.message).toContain('超出范围');
  });
});

describe('file_convert — 回归：未超限时不引入多余措辞', () => {
  test('小结果 ⇒ 只报总行数，不提截断/取回', () => {
    const small = 'a\nb\nc';
    const r = shapeMarkdownResult(small, FILE);
    expect(r.markdown).toBe(small);
    expect(r.message).toBe(`转换完成: ${FILE} → Markdown（共 3 行）`);
  });

  test('分段读取小结果 ⇒ 报行范围且不出现截断提示', () => {
    const r = shapeMarkdownResult('a\nb\nc', FILE, 2, 1);
    expect(r.markdown).toBe('b');
    expect(r.message).toContain('第 2-2 行');
    expect(r.message).not.toContain('字符已截断');
  });
});
