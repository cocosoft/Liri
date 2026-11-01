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
 * webhook 入站真实性校验测试（4.2 / P0-2）
 * 覆盖：secret 校验（token 头/Bearer）、时间戳窗口、防重放
 */

import { describe, expect, it } from 'bun:test';
import { verifyWebhookRequest } from '../../src/channels/webhook/WebhookChannel';

const SECRET = 'whsec_test_123';

/**
 * 共享模块级 `replayCache`（键 = `时间戳_sha256(body)`）跨用例存活：
 * 两个防重放用例都用 `{"a":1}`，若各自随机时间戳撞到同一值 ⇒ 后者被误判 409（CI 偶发红灯）。
 * 故时间戳按**严格递增**分配：`Date.now()` 非降 + 序号严格增 ⇒ 各用例取值必然互不相同。
 */
let tsSeq = 0;
function freshTs(): string {
  tsSeq += 1;
  return String(Date.now() + tsSeq);
}

describe('verifyWebhookRequest（4.2）', () => {
  it('未配置 secret 时放行（兼容无凭据回调）', () => {
    const r = verifyWebhookRequest({}, '{"a":1}');
    expect(r.ok).toBe(true);
  });

  it('X-Webhook-Token 与 secret 一致 → 放行', () => {
    const r = verifyWebhookRequest(
      { 'x-webhook-token': SECRET },
      '{"a":1}',
      SECRET
    );
    expect(r.ok).toBe(true);
  });

  it('Authorization: Bearer 与 secret 一致 → 放行', () => {
    const r = verifyWebhookRequest(
      { authorization: `Bearer ${SECRET}` },
      '{"a":1}',
      SECRET
    );
    expect(r.ok).toBe(true);
  });

  it('secret 不匹配 → 拒绝 401', () => {
    const r = verifyWebhookRequest(
      { 'x-webhook-token': 'wrong' },
      '{"a":1}',
      SECRET
    );
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });

  it('配置了 secret 但未携带 → 拒绝 401', () => {
    const r = verifyWebhookRequest({}, '{"a":1}', SECRET);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });

  it('时间戳超出 5 分钟窗口 → 拒绝 401', () => {
    const stale = String(Date.now() - 10 * 60 * 1000);
    const r = verifyWebhookRequest({ 'x-webhook-timestamp': stale }, '{"a":1}');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });

  it('时间戳有效但同 body 重放 → 拒绝 409', () => {
    const ts = freshTs();
    const body = '{"a":1}';
    const first = verifyWebhookRequest({ 'x-webhook-timestamp': ts }, body);
    expect(first.ok).toBe(true);
    const replay = verifyWebhookRequest({ 'x-webhook-timestamp': ts }, body);
    expect(replay.ok).toBe(false);
    expect(replay.status).toBe(409);
  });

  it('时间戳有效 + 不同 body → 放行', () => {
    const ts = freshTs();
    const first = verifyWebhookRequest(
      { 'x-webhook-timestamp': ts },
      '{"a":1}'
    );
    expect(first.ok).toBe(true);
    const second = verifyWebhookRequest(
      { 'x-webhook-timestamp': ts },
      '{"a":2}'
    );
    expect(second.ok).toBe(true);
  });
});
