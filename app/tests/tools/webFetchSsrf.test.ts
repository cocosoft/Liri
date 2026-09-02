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
import { checkSsrf } from '../../src/tools/WebFetchTool/ssrf';
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
    dns.promises.resolve4 = (async () => ['10.0.0.1']) as unknown as typeof ORIG_RESOLVE4;
    const r = await checkSsrf('http://evil.example.com/');
    expect(r.blocked).toBe(true);
  });

  it('域名解析到云元数据 IP 时拦截', async () => {
    dns.promises.resolve4 = (async () => ['169.254.169.254']) as unknown as typeof ORIG_RESOLVE4;
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
    const r = await tool.execute(
      { url: 'http://100.64.0.1/' },
      {} as never
    );
    expect(String(r.data)).toContain('SSRF');
  });
});
