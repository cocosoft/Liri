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
 * D6-B：`browser_vision` 复用 `BrowserSessionDriver` 会话（2026-11-21）
 *
 * 断言：
 * - 截图走**同一会话驱动**（不再直连 CDP 9222），并请求 jpeg + quality；
 * - 截图落盘到会话目录（返回路径）；
 * - 驱动失败 / 无已打开页面（about:blank）⇒ 明确失败，不假装成功。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import type {
  BrowserActionRequest,
  BrowserDriverResult,
} from '@openliri/tool-browser';
import { BrowserVisionTool } from '@openliri/tool-browser';
import { cleanupScreenshotFiles } from '@openliri/infra/utils/computerUse/screenshotStore';
import type { ToolUseContext } from '../../src/tools/types/ToolUseContext';

const SESSION = 'test-session-browser-vision';
const ctx = { sessionId: SESSION } as unknown as ToolUseContext;

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

const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9,
]);

afterAll(() => {
  cleanupScreenshotFiles(SESSION);
});

describe('D6-B：browser_vision 复用浏览器会话', () => {
  it('截图委托会话驱动（jpeg + quality），落盘后返回路径', async () => {
    const driver = fakeDriver(() => ({
      success: true,
      action: 'screenshot',
      url: 'https://example.com/',
      title: 'Example Domain',
      screenshot: JPEG_BYTES,
      durationMs: 5,
    }));
    const tool = new BrowserVisionTool(() => driver);

    const res = await tool.execute({ prompt: 'describe', quality: 70 }, ctx);

    expect(driver.calls).toHaveLength(1);
    expect(driver.calls[0]).toMatchObject({
      action: 'screenshot',
      format: 'jpeg',
      quality: 70,
      fullPage: false,
    });

    expect(res.success).toBe(true);
    const data = res.data as { screenshotPath?: string; analysis?: string };
    expect(data.screenshotPath).toBeTruthy();
    expect(existsSync(data.screenshotPath as string)).toBe(true);
    expect(readFileSync(data.screenshotPath as string).equals(JPEG_BYTES)).toBe(
      true
    );
  });

  it('驱动失败 ⇒ 明确报错（不假装成功）', async () => {
    const driver = fakeDriver(() => ({
      success: false,
      action: 'screenshot',
      error: 'browser closed',
      durationMs: 1,
    }));
    const tool = new BrowserVisionTool(() => driver);

    const res = await tool.execute({}, ctx);
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('无法获取浏览器截图');
  });

  it('会话只有 about:blank ⇒ 视为没有可分析页面', async () => {
    const driver = fakeDriver(() => ({
      success: true,
      action: 'screenshot',
      url: 'about:blank',
      screenshot: JPEG_BYTES,
      durationMs: 1,
    }));
    const tool = new BrowserVisionTool(() => driver);

    const res = await tool.execute({}, ctx);
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('无法获取浏览器截图');
  });
});
