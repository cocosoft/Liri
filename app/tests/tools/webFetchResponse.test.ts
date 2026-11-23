// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `readResponseContent` 用例（P3-2：`WebFetchTool.execute` 降复杂度的同时补 IO 接缝测试）
 *
 * 覆盖此前只能整体跑工具才能验证的三条判据：JSON 美化、文本原样、超长截断（含原始长度标注）。
 */
import { describe, it, expect } from 'bun:test';
import { readResponseContent } from '@openliri/tool-web/WebFetchTool/webFetchResponse';

/** 构造一个最小响应（`readResponseContent` 只需 headers/json/text） */
function makeResponse(body: string, contentType?: string): Response {
  return new Response(body, {
    headers: contentType ? { 'content-type': contentType } : {},
  });
}

describe('readResponseContent', () => {
  it('content-type 含 application/json ⇒ 解析后美化输出（2 空格缩进）', async () => {
    const response = makeResponse('{"a":1,"b":[2,3]}', 'application/json');
    const { content, contentType } = await readResponseContent(
      response,
      10_000
    );
    expect(contentType).toContain('application/json');
    expect(content).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
  });

  it('非 JSON（含缺失 content-type）⇒ 原样文本，不做 JSON 解析', async () => {
    const plain = await readResponseContent(
      makeResponse('<html>x</html>'),
      10_000
    );
    expect(plain.content).toBe('<html>x</html>');
    expect(plain.contentType).toBe('');

    const html = await readResponseContent(
      makeResponse('<html>y</html>', 'text/html; charset=utf-8'),
      10_000
    );
    expect(html.content).toBe('<html>y</html>');
  });

  it('超过 maxContentLength ⇒ 截断并标注**原始长度**（不是截断后的长度）', async () => {
    const body = 'a'.repeat(50);
    const { content } = await readResponseContent(makeResponse(body), 10);
    expect(content.startsWith('a'.repeat(10))).toBe(true);
    expect(content).toContain(
      '[Content truncated. Original length: 50 characters]'
    );
  });

  it('恰好等于 maxContentLength ⇒ 不截断、不加标注', async () => {
    const body = 'b'.repeat(10);
    const { content } = await readResponseContent(makeResponse(body), 10);
    expect(content).toBe(body);
  });
});
