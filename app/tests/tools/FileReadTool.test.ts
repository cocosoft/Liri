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
 * FileReadTool 大文件分段读取测试（2026-09-03）
 *
 * 根因修复验证：此前 >10MiB 文件无论是否带 offset/limit 一律拒绝（"File too large"），
 * 模型陷入"读大日志失败 → 反复探测"空转直至 50 轮超限中断。
 * 修复后：带 offset 的分段读取放行（整读后切片返回）；无 offset 拒绝并给出分段指引。
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { writeFileSync, rmSync, mkdtempSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFile } from '../../src/tools/FileReadTool/FileReadTool';

describe('FileReadTool — 大文件分段读取（>10MiB）', () => {
  // 构造 ~10.6MiB 文本文件（5500 行 × 2000 字符），utf8（native 编码检测不可用时走 utf8 fallback）
  const dir = mkdtempSync(join(tmpdir(), 'fileread-test-'));
  const bigPath = join(dir, 'big.log');
  const line = 'x'.repeat(1999); // + \n = 2000 bytes/行
  let totalLines = 0;

  beforeAll(() => {
    const rows: string[] = [];
    for (let i = 0; i < 5500; i++) rows.push(line);
    totalLines = rows.length;
    writeFileSync(bigPath, rows.join('\n') + '\n');
    // 确保确实超过 10MiB 上限
    expect(statSync(bigPath).size).toBeGreaterThan(10 * 1024 * 1024);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('无 offset 读 >10MiB 文件 → 拒绝且报错含分段读取指引', () => {
    expect(() => readFile({ filePath: bigPath })).toThrow(
      /Use segmented reads/
    );
  });

  test('带 offset/limit 分段读取超限文件 → 成功返回对应区间', () => {
    const r = readFile({ filePath: bigPath, offset: 1, limit: 3 });
    // 尾行换行导致 split 多一个空串项（5500 内容行 + 1 尾空），断言宽松至 >= 内容行数
    expect(r.totalLines).toBeGreaterThanOrEqual(totalLines);
    expect(r.lineCount).toBe(3);
    expect(r.content.split('\n').filter(Boolean)).toHaveLength(3);
    expect(r.content.length).toBeGreaterThan(0);
    expect(r.truncated).toBe(true);
  });

  test('分段读取中段/尾部偏移正确', () => {
    const r = readFile({ filePath: bigPath, offset: totalLines - 1, limit: 2 });
    expect(r.lineCount).toBe(2);
    expect(r.offset).toBe(totalLines - 1);
  });

  test('小文件（<10MiB）正常整读（回归）', () => {
    const smallPath = join(dir, 'small.txt');
    writeFileSync(smallPath, 'a\nb\nc\n');
    const r = readFile({ filePath: smallPath });
    expect(r.content.split('\n').filter(Boolean)).toHaveLength(3);
    expect(r.truncated).toBe(false);
  });
});
