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
 * WebFetch SSRF 防护测试（2026-09-02，P3-1 对标 Hermes url_safety 落地）
 *
 * 验证：
 * - checkSsrf 拦截内网/回环/链路本地/云元数据/CGNAT/benchmark 段
 * - checkSsrf 放行公共地址
 * - 域名 DNS 解析到内网 IP 时拦截（DNS rebinding 预检）
 * - WebFetchTool.execute 对接 checkSsrf，被拦 URL 不发请求直接返回
 */
import { describe, it, expect, afterEach } from 'bun:test';
import * as dns from 'node:dns';
import {
  checkSsrf,
  describeSsrfBlock,
} from '../../src/tools/WebFetchTool/ssrf';
import { WebFetchTool } from '../../src/tools/WebFetchTool/WebFetchTool';

const ORIG_RESOLVE4 = dns.promises.resolve4;

afterEach(() => {
  dns.promises.resolve4 = ORIG_RESOLVE4;
});

describe('checkSsrf 基础拦截（字面量地址）', () => {
  const blockedCases = [
    'http://127.0.0.1/', // loopback
    'http://0.0.0.0/', // unspecified
    'http://10.0.0.1/', // private A
    'http://172.16.0.1/', // private B
    'http://192.168.1.1/', // private C
    'http://169.254.169.254/latest/meta-data/', // 云元数据（AWS/GCP/Azure）
    'http://169.254.170.2/', // AWS ECS task metadata
    'http://100.100.100.200/', // 阿里云元数据
    'http://100.64.0.1/', // CGNAT（RFC 6598，P3-1 新增）
    'http://198.18.0.1/', // benchmark 段（RFC 2544，P3-1 新增）
    'http://localhost:8080/', // 内部 hostname
    'http://metadata.google.internal/', // 云元数据 hostname（.internal TLD）
  ];

  for (const url of blockedCases) {
    it(`拦截 ${url}`, async () => {
      const r = await checkSsrf(url);
      expect(r.blocked).toBe(true);
    });
  }
});

describe('checkSsrf 放行公共地址', () => {
  it('公共 IP 字面量放行', async () => {
    const r = await checkSsrf('http://93.184.216.34/');
    expect(r.blocked).toBe(false);
    expect(r.safe).toBe(true);
  });

  it('非 http/https 协议拦截', async () => {
    const r = await checkSsrf('ftp://example.com/file.txt');
    expect(r.blocked).toBe(true);
  });
});

describe('checkSsrf DNS 解析到内网（DNS rebinding 预检）', () => {
  it('域名解析到内网 IP 时拦截', async () => {
    dns.promises.resolve4 = (async () => [
      '10.0.0.1',
    ]) as unknown as typeof ORIG_RESOLVE4;
    const r = await checkSsrf('http://evil.example.com/');
    expect(r.blocked).toBe(true);
  });

  it('域名解析到云元数据 IP 时拦截', async () => {
    dns.promises.resolve4 = (async () => [
      '169.254.169.254',
    ]) as unknown as typeof ORIG_RESOLVE4;
    const r = await checkSsrf('http://attacker-controlled.example.com/');
    expect(r.blocked).toBe(true);
    expect(r.riskLevel).toBe('critical');
  });
});

describe('WebFetchTool.execute 对接 SSRF', () => {
  const tool = new WebFetchTool();

  it('云元数据 URL 被拦截且不发起请求', async () => {
    const r = await tool.execute(
      { url: 'http://169.254.169.254/latest/meta-data/' },
      {} as never
    );
    expect(String(r.data)).toContain('SSRF');
  });

  it('内网 URL 被拦截', async () => {
    const r = await tool.execute(
      { url: 'http://127.0.0.1:8080/secret' },
      {} as never
    );
    expect(String(r.data)).toContain('SSRF');
  });

  it('CGNAT 段被拦截', async () => {
    const r = await tool.execute({ url: 'http://100.64.0.1/' }, {} as never);
    expect(String(r.data)).toContain('SSRF');
  });
});

/**
 * 方案 C（2026-09-25）：拦截文案区分「代理 fake-IP」与「内网目标」。
 *
 * 背景（台账 N-61）：实测 arxiv 系列域名被解析到 198.19.0.x（企业代理 fake-IP 池），
 * 旧文案只有一句英文 `DNS resolved to private ip: …` ⇒ 模型无法判断"这是环境特性还是真实威胁"，
 * 只能靠猜并自行绕道本地文件。以下用例**锁死两类文案不得混用**。
 */
describe('SSRF 拦截文案：两类原因不得混用（方案 C）', () => {
  it('解析到 198.19.0.4（代理 fake-IP）⇒ 判为代理行为、非内网目标，并给替代路径', async () => {
    dns.promises.resolve4 = (async () => [
      '198.19.0.4',
    ]) as unknown as typeof ORIG_RESOLVE4;
    const r = await checkSsrf('http://arxiv.org/abs/2608.21156');
    expect(r.blocked).toBe(true);
    expect(r.details?.[0]?.type).toBe('proxy_fake_ip');

    const msg = describeSsrfBlock(r);
    expect(msg).toContain('198.19.0.4');
    expect(msg).toContain('fake-IP');
    expect(msg).toContain('并非内网目标');
    expect(msg).toContain('file_read');
    // 不得把环境特性说成真实威胁
    expect(msg).not.toContain('疑似内网目标');
  });

  it('解析到 10.0.0.1（真实内网）⇒ 判为疑似内网目标，且不提 fake-IP', async () => {
    dns.promises.resolve4 = (async () => [
      '10.0.0.1',
    ]) as unknown as typeof ORIG_RESOLVE4;
    const r = await checkSsrf('http://evil.example.com/');
    expect(r.blocked).toBe(true);
    expect(r.details?.[0]?.type).toBe('private_ip');

    const msg = describeSsrfBlock(r);
    expect(msg).toContain('10.0.0.1');
    expect(msg).toContain('疑似内网目标');
    expect(msg).not.toContain('fake-IP');
  });

  it('字面量 198.19.0.4 同样归入 fake-IP 段（判定不放宽，仅分类与文案变化）', async () => {
    const r = await checkSsrf('http://198.19.0.4/');
    expect(r.blocked).toBe(true);
    expect(r.details?.[0]?.type).toBe('proxy_fake_ip');
  });

  it('WebFetchTool 返回人话文案（技术标签 + 原因 + 替代路径）', async () => {
    dns.promises.resolve4 = (async () => [
      '198.19.0.5',
    ]) as unknown as typeof ORIG_RESOLVE4;
    const r = await new WebFetchTool().execute(
      { url: 'http://ar5iv.labs.arxiv.org/html/2608.21156' },
      {} as never
    );
    const text = String(r.data);
    expect(text).toContain('SSRF');
    expect(text).toContain('fake-IP');
    expect(text).toContain('file_read');
    expect(text).not.toContain('疑似内网目标');
  });
});
