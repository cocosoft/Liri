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
 * P4b：`PDFTool` 的两个未实现分支必须 **fail-closed**（2026-10-16）
 *
 * 背景（P4a 评估 §2.2(3)）：`extract` / `info` 依赖**未安装**的 `pdf-parse`，而原实现返回
 * `success: true` + 占位文本（`text: '[PDF text extraction requires a PDF parsing library]'`）
 * 或 `pages: 'unknown'` —— 属**假成功**（`coding-standards.md` CS04 零容忍：模型会把占位符
 * 当成真实抽取结果）。接线 `pdf` 的前提就是先收口这两处。
 *
 * 本用例把"三不"钉死（可真机复现、不写盘、不依赖外部库）：
 *   ① `extract` ⇒ `success:false` 且给出可用替代工具；
 *   ② `info`   ⇒ `success:false`（不再返回 `pages: 'unknown'`）；
 *   ③ `generate` 路径**未被误伤**（其错误与 `pdf-parse` 无关 ⇒ 证明收口只落在两个桩分支上）。
 *
 * ⚠️ 刻意**不**调用真实 `generate`（它会往全局输出目录写盘）—— 用"无参数调用 generate"的
 * 校验分支即可证明路由正确（CS03：不为测试方便而制造副作用）。
 */

import { describe, expect, it } from 'bun:test';
import { PDFTool } from '../../src/tools/PDFTool/PDFTool';

const CTX = {} as never;

describe('P4b：PDFTool extract/info fail-closed（原为假成功）', () => {
  const tool = new PDFTool();

  it('extract ⇒ success:false，并指向 media_pdf_extract / file_read（不再返回占位文本）', async () => {
    const r = await tool.execute(
      { action: 'extract', filepath: '/tmp/does-not-matter.pdf' },
      CTX
    );
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain('media_pdf_extract');
    // 反向自证：占位文本不再出现在输出里
    expect(JSON.stringify(r)).not.toContain(
      'requires a PDF parsing library]'
    );
  });

  it('info ⇒ success:false（不再伪造 pages/title 为 unknown）', async () => {
    const r = await tool.execute(
      { action: 'info', filepath: '/tmp/does-not-matter.pdf' },
      CTX
    );
    expect(r.success).toBe(false);
    expect(JSON.stringify(r)).not.toContain('unknown');
  });

  it('generate 路径未被误伤（其报错与 pdf-parse 无关）', async () => {
    const r = await tool.execute({ action: 'generate' }, CTX);
    expect(r.success).toBe(false); // 缺 title/content ⇒ 校验失败
    expect(String(r.error)).not.toContain('pdf-parse');
  });
});
