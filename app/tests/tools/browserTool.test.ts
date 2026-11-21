// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2（2026-11-21）：`browser` 接真实现后的行为回归锁。
 *
 * 背景：本工具此前是**假实现**（恒成功 + 1×1 假截图 + 写死标签页，违反 CS04）。
 * 现改为委托 `PlaywrightDriver`（playwright-core + 系统 Chrome/Edge）。本文件用**注入的假驱动**
 * 覆盖动作映射 / 失败传播 / 截图落盘（不回 base64）/ 开关拒绝；URL 安全规则走纯函数断言。
 */

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';

import { BrowserTool } from '../../src/tools/BrowserTool/BrowserTool';
import {
  assertUrlAllowed,
  resolveBrowserDriverConfig,
  type BrowserActionRequest,
  type BrowserDriverResult,
} from '@openliri/tool-browser';
import {
  cleanupScreenshotFiles,
  resolveScreenshotDir,
} from '@openliri/infra/utils/computerUse/screenshotStore';
import type { ToolUseContext } from '../../src/tools/types/ToolUseContext';

const SESSION = 'test-session-browser';
const ctx = { sessionId: SESSION } as unknown as ToolUseContext;

/** 记录调用并按需返回结果的假驱动 */
function fakeDriver(
  handler: (req: BrowserActionRequest) => BrowserDriverResult
) {
  const calls: BrowserActionRequest[] = [];
  return {
    calls,
    execute: async (req: BrowserActionRequest) => {
      calls.push(req);
      return handler(req);
    },
  };
}

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFeAJ6ME3L9UAAAAABJRU5ErkJggg==',
  'base64'
);

describe('P2：browser 工具行为（假驱动）', () => {
  const prevGate = process.env.FEATURE_BROWSER;

  beforeEach(() => {
    process.env.FEATURE_BROWSER = 'true';
  });

  afterAll(() => {
    if (prevGate === undefined) delete process.env.FEATURE_BROWSER;
    else process.env.FEATURE_BROWSER = prevGate;
    cleanupScreenshotFiles(SESSION);
  });

  it('开关关闭 ⇒ 明确拒绝并给出开启方式', async () => {
    delete process.env.FEATURE_BROWSER;
    const driver = fakeDriver(() => ({
      success: true,
      action: 'navigate',
      durationMs: 0,
    }));
    const tool = new BrowserTool(() => driver);
    const res = await tool.execute(
      { action: 'navigate', url: 'https://example.com' },
      ctx
    );
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('BROWSER');
    expect(driver.calls).toHaveLength(0);
  });

  it('navigate 委托驱动并回读标题/URL', async () => {
    const driver = fakeDriver(() => ({
      success: true,
      action: 'navigate',
      url: 'https://example.com/',
      title: 'Example Domain',
      durationMs: 3,
    }));
    const tool = new BrowserTool(() => driver);
    const res = await tool.execute(
      { action: 'navigate', url: 'https://example.com' },
      ctx
    );
    expect(res.success).toBe(true);
    expect(String(res.output)).toContain('Example Domain');
    expect(driver.calls[0].action).toBe('navigate');
  });

  it('fill_form 按 form_data 逐选择器填充', async () => {
    const driver = fakeDriver((req) => ({
      success: true,
      action: String(req.action),
      durationMs: 1,
    }));
    const tool = new BrowserTool(() => driver);
    const res = await tool.execute(
      {
        action: 'fill_form',
        form_data: { '#name': 'liri', '#pw': 'secret' },
      },
      ctx
    );
    expect(res.success).toBe(true);
    expect(driver.calls.map((c) => [c.action, c.selector, c.value])).toEqual([
      ['fill', '#name', 'liri'],
      ['fill', '#pw', 'secret'],
    ]);
  });

  it('截图落盘：只回路径、不含 base64', async () => {
    const driver = fakeDriver(() => ({
      success: true,
      action: 'screenshot',
      url: 'https://example.com/',
      title: 'Example Domain',
      screenshot: PNG_1PX,
      durationMs: 5,
    }));
    const tool = new BrowserTool(() => driver);
    const res = await tool.execute({ action: 'screenshot' }, ctx);

    expect(res.success).toBe(true);
    // 出参形状：`data` = BrowserToolOutput（其内部 `data` 为动作负载）
    const payload = (res.data as unknown as Record<string, unknown>)
      .data as Record<string, unknown>;
    expect(payload.base64).toBeUndefined();
    expect(String(payload.path)).toContain(resolveScreenshotDir(SESSION));
    expect(existsSync(String(payload.path))).toBe(true);
    expect(String(payload.path).endsWith('.png')).toBe(true);
  });

  it('驱动失败 ⇒ 原样传播错误（不假装成功）', async () => {
    const driver = fakeDriver(() => ({
      success: false,
      action: 'click',
      error: 'selector 未找到: #nope',
      durationMs: 2,
    }));
    const tool = new BrowserTool(() => driver);
    const res = await tool.execute({ action: 'click', selector: '#nope' }, ctx);
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('selector 未找到');
  });

  it('get_content 回正文；get_tabs 回标签页列表', async () => {
    const driver = fakeDriver((req) =>
      req.action === 'get_content'
        ? {
            success: true,
            action: 'get_content',
            url: 'https://example.com/',
            title: 'Example',
            content: '正文内容',
            durationMs: 1,
          }
        : {
            success: true,
            action: 'get_tabs',
            tabs: [{ index: 0, url: 'https://a/', title: 'A', active: true }],
            durationMs: 1,
          }
    );
    const tool = new BrowserTool(() => driver);

    const content = await tool.execute({ action: 'get_content' }, ctx);
    expect(content.success).toBe(true);
    expect(String(content.output)).toContain('正文内容');

    const tabs = await tool.execute({ action: 'get_tabs' }, ctx);
    expect(tabs.success).toBe(true);
    const tabsPayload = (tabs.data as unknown as Record<string, unknown>)
      .tabs as unknown[];
    expect(tabsPayload).toHaveLength(1);
  });
});

describe('P2：URL 安全规则（纯函数）', () => {
  const base = resolveBrowserDriverConfig();

  it('拒绝 file: / data: / javascript:', () => {
    for (const url of [
      'file:///C:/Windows/win.ini',
      'data:text/html,<h1>x</h1>',
      'javascript:alert(1)',
    ]) {
      expect(() => assertUrlAllowed(url, base)).toThrow();
    }
  });

  it('默认拒绝环回/内网，显式放行后允许', () => {
    expect(() => assertUrlAllowed('http://127.0.0.1:8080/', base)).toThrow();
    expect(() => assertUrlAllowed('http://192.168.1.2/', base)).toThrow();
    const allowed = { ...base, allowPrivateNetwork: true };
    expect(assertUrlAllowed('http://127.0.0.1:8080/', allowed).port).toBe(
      '8080'
    );
  });

  it('allowedDomains 非空 ⇒ 只允许命中域（含子域）', () => {
    const cfg = { ...base, allowedDomains: ['example.com'] };
    expect(assertUrlAllowed('https://example.com/a', cfg).hostname).toBe(
      'example.com'
    );
    expect(assertUrlAllowed('https://sub.example.com/a', cfg).hostname).toBe(
      'sub.example.com'
    );
    expect(() => assertUrlAllowed('https://evil.com/', cfg)).toThrow();
  });

  it('非法/相对 URL 直接拒绝', () => {
    expect(() => assertUrlAllowed('example.com', base)).toThrow();
    expect(() => assertUrlAllowed('', base)).toThrow();
  });
});
