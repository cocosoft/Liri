// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P1（2026-11-21）：`computer_use` 工具行为回归锁。
 *
 * 覆盖（对应 browser-use-and-computer-use-completion.md §5 验收）：
 *   ① 截图**只回文件路径 + 尺寸/字节数**，绝不回 base64（防撑爆上下文）；
 *   ② 文件真实落盘到会话隔离目录，stop hook 的清理函数可删净；
 *   ③ 功能开关关闭 ⇒ 明确拒绝（并给出开启方式），不静默成功；
 *   ④ 平台不支持（Noop 适配器）⇒ 明确失败，不假装成功；
 *   ⑤ 参数校验：缺参 / 未知动作走可读错误。
 */

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';

import { ComputerUseTool } from '../../src/tools/ComputerUseTool/ComputerUseTool';
import type { ComputerUseAdapter } from '@openliri/infra/utils/computerUse/types';
import {
  cleanupScreenshotFiles,
  resolveScreenshotDir,
} from '@openliri/infra/utils/computerUse/screenshotStore';
import type { ToolUseContext } from '../../src/tools/types/ToolUseContext';

const SESSION = 'test-session-computer-use';
const ctx = { sessionId: SESSION } as unknown as ToolUseContext;

/** 最小假适配器：2×2 JPEG（真实字节，便于断言尺寸/落盘） */
function fakeAdapter(): ComputerUseAdapter {
  return {
    capabilities: {
      screenshot: true,
      mouseControl: true,
      keyboardControl: true,
      clipboardAccess: true,
      appManagement: true,
      platform: 'win32',
    },
    isSupported: () => true,
    takeScreenshot: async () => ({
      data: Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x00, 0x01]),
      format: 'jpeg',
      width: 2,
      height: 2,
    }),
    mouseAction: async () => {},
    getMousePosition: async () => ({ x: 1, y: 2 }),
    keyboardAction: async () => {},
    getClipboard: async () => 'clip',
    setClipboard: async () => {},
    getRunningApps: async () => [],
    getFrontmostApp: async () => null,
    getDisplayGeometry: async () => ({
      width: 1920,
      height: 1080,
      scaleFactor: 1,
    }),
    getAllDisplays: async () => [],
    launchApp: async () => true,
    destroy: async () => {},
  } as unknown as ComputerUseAdapter;
}

/** 平台不支持的适配器（Noop 语义） */
function unsupportedAdapter(): ComputerUseAdapter {
  return {
    ...fakeAdapter(),
    isSupported: () => false,
  } as unknown as ComputerUseAdapter;
}

describe('P1：computer_use 工具行为', () => {
  const prevGate = process.env.FEATURE_COMPUTER_USE;

  beforeEach(() => {
    process.env.FEATURE_COMPUTER_USE = 'true';
  });

  afterAll(() => {
    if (prevGate === undefined) delete process.env.FEATURE_COMPUTER_USE;
    else process.env.FEATURE_COMPUTER_USE = prevGate;
    cleanupScreenshotFiles(SESSION);
  });

  it('开关关闭 ⇒ 明确拒绝并给出开启方式', async () => {
    delete process.env.FEATURE_COMPUTER_USE;
    const tool = new ComputerUseTool(fakeAdapter);
    const res = await tool.execute({ action: 'getMousePos' }, ctx);
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('COMPUTER_USE');
    expect(String(res.error)).toContain('功能开关');
  });

  it('截图只回路径/尺寸，不含 base64，且文件真实落盘', async () => {
    const tool = new ComputerUseTool(fakeAdapter);
    const res = await tool.execute({ action: 'screenshot' }, ctx);

    expect(res.success).toBe(true);
    const data = res.data as Record<string, unknown>;
    expect(data.base64).toBeUndefined();
    expect(data.width).toBe(2);
    expect(data.height).toBe(2);
    expect(typeof data.path).toBe('string');
    expect(String(data.path)).toContain(resolveScreenshotDir(SESSION));
    expect(existsSync(String(data.path))).toBe(true);
    expect(String(res.output)).toContain('analyze=true');
  });

  it('清理函数删净本会话截图', async () => {
    const tool = new ComputerUseTool(fakeAdapter);
    await tool.execute({ action: 'screenshot' }, ctx);
    const removed = cleanupScreenshotFiles(SESSION);
    expect(removed).toBeGreaterThanOrEqual(1);
  });

  it('平台不支持 ⇒ 明确失败（Noop 不假装成功）', async () => {
    const tool = new ComputerUseTool(unsupportedAdapter);
    const res = await tool.execute({ action: 'screenshot' }, ctx);
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('only supported');
  });

  it('缺参 / 未知动作走可读错误', async () => {
    const tool = new ComputerUseTool(fakeAdapter);
    const missing = await tool.execute({ action: 'mouseMove' }, ctx);
    expect(missing.success).toBe(false);
    expect(String(missing.error)).toContain('x and y are required');

    const unknown = await tool.execute(
      { action: 'not-an-action' as never },
      ctx
    );
    expect(unknown.success).toBe(false);
    expect(String(unknown.error)).toContain('Unknown action');
  });

  it('鼠标移动成功路径（动作分派）', async () => {
    const tool = new ComputerUseTool(fakeAdapter);
    const res = await tool.execute({ action: 'mouseMove', x: 10, y: 20 }, ctx);
    expect(res.success).toBe(true);
    expect(String(res.output)).toContain('(10, 20)');
  });
});
