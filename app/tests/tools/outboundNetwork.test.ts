/**
 * 出站网络层回归（2026-11-03）
 *
 * 锁定三件事（回退旧实现必红）：
 * 1. 代理解析：env 优先、Windows 系统代理可归一化、回环与 NO_PROXY 永远直连；
 * 2. 出站请求真的带上解析出的代理（Bun 的 `proxy` 选项），且超时/取消不被误报为通道失败；
 * 3. WebSearch / WebFetch 不得再裸调 `fetch`（这是"工具明明能连却走直连"的根因）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  normalizeProxyUrl,
  resolveProxyForUrl,
  shouldBypassProxy,
} from '@openliri/infra/utils/proxy';
import {
  OutboundTransportError,
  describeOutboundFailure,
  outboundFetch,
  redactProxyUrl,
} from '@openliri/infra/utils/outboundFetch';

const TOOLS_DIR = join(import.meta.dir, '../../src/tools');

const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
  'NO_PROXY',
  'no_proxy',
];

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  // 让解析绕过"系统代理读取"这一层：测试只验证 env 与规则，不依赖本机注册表
  process.env['NO_PROXY'] = 'registry-probe-sentinel';
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('代理值归一化（normalizeProxyUrl）', () => {
  it('缺协议时补 http://', () => {
    expect(normalizeProxyUrl('127.0.0.1:17897')).toBe('http://127.0.0.1:17897');
  });

  it('已有协议原样保留', () => {
    expect(normalizeProxyUrl('socks5://127.0.0.1:1080')).toBe(
      'socks5://127.0.0.1:1080'
    );
    expect(normalizeProxyUrl('http://127.0.0.1:7890')).toBe(
      'http://127.0.0.1:7890'
    );
  });

  it('Windows 复合格式取 https 段', () => {
    expect(normalizeProxyUrl('http=127.0.0.1:8080;https=127.0.0.1:8443')).toBe(
      'http://127.0.0.1:8443'
    );
  });

  it('空值 -> undefined', () => {
    expect(normalizeProxyUrl('')).toBeUndefined();
    expect(normalizeProxyUrl('   ')).toBeUndefined();
    expect(normalizeProxyUrl(undefined)).toBeUndefined();
  });
});

describe('代理解析（resolveProxyForUrl / shouldBypassProxy）', () => {
  it('环境变量优先', () => {
    process.env['HTTPS_PROXY'] = '127.0.0.1:9999';
    const resolution = resolveProxyForUrl('https://www.bing.com/search');
    expect(resolution.source).toBe('env');
    expect(resolution.proxyUrl).toBe('http://127.0.0.1:9999');
    expect(resolution.bypassed).toBe(false);
  });

  it('回环永远直连（不受代理影响）', () => {
    process.env['HTTPS_PROXY'] = '127.0.0.1:9999';
    expect(shouldBypassProxy('http://127.0.0.1:3000/v1/models')).toBe(true);
    expect(
      resolveProxyForUrl('http://localhost:3000/v1/models').bypassRule
    ).toBe('loopback');
  });

  it('NO_PROXY 域名规则生效', () => {
    process.env['HTTPS_PROXY'] = '127.0.0.1:9999';
    process.env['NO_PROXY'] = '.example.com,registry-probe-sentinel';
    expect(shouldBypassProxy('https://www.example.com/x')).toBe(true);
  });

  it('NO_PROXY=* 全部直连', () => {
    process.env['HTTPS_PROXY'] = '127.0.0.1:9999';
    process.env['NO_PROXY'] = '*';
    expect(shouldBypassProxy('https://www.bing.com/search')).toBe(true);
  });

  it('无 env 且无系统代理 -> 直连', () => {
    // 本测试进程的 NO_PROXY 哨兵不匹配目标主机；若本机恰有系统代理，
    // 该断言只验证"没有 env 时不会凭空造出 env 代理"，来源允许是 system。
    const resolution = resolveProxyForUrl('https://www.bing.com/search');
    expect(resolution.source).not.toBe('env');
    if (resolution.source === 'none') {
      expect(resolution.proxyUrl).toBeUndefined();
    }
  });
});

describe('outboundFetch（统一出站）', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('Bun 运行时把解析出的代理传给 fetch', async () => {
    process.env['HTTPS_PROXY'] = '127.0.0.1:9999';
    let capturedInit: (RequestInit & { proxy?: string }) | undefined;

    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      capturedInit = init as RequestInit & { proxy?: string };
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    await outboundFetch('https://www.bing.com/search?q=test');
    expect(capturedInit?.proxy).toBe('http://127.0.0.1:9999');
  });

  it('AbortError 原样透传（超时/取消不算通道不可达）', async () => {
    globalThis.fetch = (async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }) as unknown as typeof fetch;

    await expect(outboundFetch('https://www.bing.com/search')).rejects.toThrow(
      'aborted'
    );
  });

  it('连接失败包装为 OutboundTransportError 并带代理来源', async () => {
    process.env['HTTPS_PROXY'] = '127.0.0.1:9999';
    globalThis.fetch = (async () => {
      const err = new Error('connect failed');
      (err as NodeJS.ErrnoException).code = 'ECONNREFUSED';
      throw err;
    }) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await outboundFetch('https://www.bing.com/search');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(OutboundTransportError);
    const message = describeOutboundFailure(caught);
    expect(message).toContain('ECONNREFUSED');
    expect(message).toContain('env 代理');
    expect(message).toContain('不代表"没有相关内容"');
  });
});

describe('redactProxyUrl（日志/文案里不得出现代理凭证）', () => {
  it('剥掉 username/password', () => {
    expect(redactProxyUrl('http://user:pass@127.0.0.1:7890')).toBe(
      'http://127.0.0.1:7890'
    );
  });
});

describe('结构性守卫：工具不得再裸调 fetch', () => {
  const readTool = (relativePath: string): string =>
    readFileSync(join(TOOLS_DIR, relativePath), 'utf8');

  it('WebSearchTool 经 outboundFetch 出站', () => {
    const source = readTool('WebSearchTool/WebSearchTool.ts');
    expect(source).toContain('outboundFetch');
    expect(source).not.toMatch(/await\s+fetch\(/);
  });

  it('WebFetchTool 经 outboundFetch 出站（含重定向逐跳）', () => {
    const source = readTool('WebFetchTool/WebFetchTool.ts');
    expect(source).toContain('outboundFetch');
    expect(source).not.toMatch(/await\s+fetch\(/);
  });

  it('providers.ts 经 outboundFetch 出站', () => {
    const source = readTool('WebSearchTool/providers.ts');
    expect(source).toContain('outboundFetch');
    expect(source).not.toMatch(/await\s+fetch\(/);
  });
});
