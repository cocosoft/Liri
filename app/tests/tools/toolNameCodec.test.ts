/**
 * 工具名 wire codec 回归测试（V-17，2026-09-14；2026-09-27 移植回 main）
 *
 * 背景：工具名存在两种语义——内部标识（`模块:动作`，如 `calendar:add`）与 wire 格式
 * （OpenAI 兼容 `tools[].function.name` 只接受 `^[a-zA-Z0-9_-]+$`）。混用导致冒号工具
 * 一旦进入 `tools[]` 即被 provider 以 400 拒绝（`invalid_request_error`），整轮对话失败
 * —— 实测（2026-09-27）表现为用户感知的「长程任务中断」
 * （`debug-long-task-interrupt.md`）。
 *
 * 本测试固化四件事：
 *  ① codec 转换正确且幂等；
 *  ② `ToolRegistry` 注册期自动登记 wire 安全别名 ⇒ 入站（模型回传安全名）可解析回真名；
 *  ③ 实测涉及的冒号工具名经 codec 后一律合规（防"某工具名漏网"）；
 *  ④ wire 安全名冲突时**跳过别名登记**（不做静默改名，避免两工具抢同一 wire 名）。
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  isWireSafeToolName,
  toWireToolName,
} from '../../src/tools/toolNameCodec';
import { createToolRegistry } from '../../src/tools/ToolRegistry';
import type { Tool } from '../../src/tools/types/Tool';

/** 最小替身：注册期只读取 `name` / `aliases`，故此处足够驱动别名逻辑 */
function fakeTool(name: string, aliases?: string[]): Tool {
  return (aliases ? { name, aliases } : { name }) as unknown as Tool;
}

afterEach(() => {
  // 各用例独立建注册表，无需清理全局单例
});

describe('toolNameCodec — 转换与判定', () => {
  it('冒号命名空间 → wire 安全名', () => {
    expect(toWireToolName('calendar:add')).toBe('calendar_add');
    expect(toWireToolName('media:image:convert')).toBe('media_image_convert');
    expect(toWireToolName('office:workflow')).toBe('office_workflow');
  });

  it('已是安全名时幂等（原值返回）', () => {
    for (const name of ['file_write', 'bash', 'MCPTool', 'cron_create']) {
      expect(toWireToolName(name)).toBe(name);
      expect(isWireSafeToolName(name)).toBe(true);
    }
  });

  it('安全名判定：冒号 / 斜杠 / 点 / 空格均不合规', () => {
    expect(isWireSafeToolName('calendar:add')).toBe(false);
    expect(isWireSafeToolName('a/b')).toBe(false);
    expect(isWireSafeToolName('a.b')).toBe(false);
    expect(isWireSafeToolName('a b')).toBe(false);
  });

  it('实测涉及的冒号工具名经 codec 后一律合规（防漏网）', () => {
    // 取自运行期日志证据（`streamMessage:tools — 按任务裁剪工具集` 后保留下发者）
    const observed = [
      'calendar:add',
      'calendar:list',
      'calendar:update',
      'calendar:delete',
      'mail:send',
      'office:workflow',
      'office:doc-pipeline',
      'module:help',
      'module:health',
      'config:exists',
      'channels:configured',
      'plugins:configured',
      'model:configured',
      'config:has-agent',
    ];
    for (const name of observed) {
      const wire = toWireToolName(name);
      expect(isWireSafeToolName(wire)).toBe(true);
      // 逐字符复核 provider 的校验正则（不依赖 codec 自身实现）
      expect(/^[a-zA-Z0-9_-]+$/.test(wire)).toBe(true);
    }
  });
});

describe('ToolRegistry — wire 别名（入站回真名）', () => {
  it('wire 安全名可解析回真名（模型侧只见安全名）', () => {
    const registry = createToolRegistry();
    registry.registerTool(fakeTool('calendar:add'));
    expect(registry.getTool('calendar:add')?.name).toBe('calendar:add');
    expect(registry.getTool('calendar_add')?.name).toBe('calendar:add');
    expect(registry.resolveRegisteredName('calendar_add')).toBe('calendar:add');
    expect(registry.resolveRegisteredName('calendar:add')).toBe('calendar:add');
  });

  it('已安全名与未知名均原样返回（不臆造）', () => {
    const registry = createToolRegistry();
    registry.registerTool(fakeTool('file_write'));
    expect(registry.resolveRegisteredName('file_write')).toBe('file_write');
    expect(registry.resolveRegisteredName('no_such_tool')).toBe('no_such_tool');
  });

  it('注销工具时清理自动登记的 wire 别名', () => {
    const registry = createToolRegistry();
    registry.registerTool(fakeTool('calendar:add'));
    expect(registry.getTool('calendar_add')).toBeDefined();
    registry.unregisterTool('calendar:add');
    expect(registry.getTool('calendar_add')).toBeUndefined();
    expect(registry.resolveRegisteredName('calendar_add')).toBe('calendar_add');
  });

  it('wire 安全名冲突时跳过别名登记（不做静默改名）', () => {
    const registry = createToolRegistry();
    // 占位：已存在一个真名叫 calendar_add 的工具
    registry.registerTool(fakeTool('calendar_add'));
    registry.registerTool(fakeTool('calendar:add'));
    // 冲突 ⇒ 别名不登记：calendar_add 仍指向占位工具，calendar:add 保持真名可用
    expect(registry.resolveRegisteredName('calendar_add')).toBe('calendar_add');
    expect(registry.getTool('calendar:add')?.name).toBe('calendar:add');
  });
});
