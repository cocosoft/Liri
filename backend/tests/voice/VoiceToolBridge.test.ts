/**
 * VoiceToolBridge 单元测试
 * 覆盖工具调用桥接、超时处理、委托模式
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { VoiceToolBridge } from '../../src/voice/VoiceToolBridge.js';
import type { ToolExecutorDelegate } from '../../src/voice/VoiceToolBridge.js';
import type { VoiceToolCallEvent, VoiceToolDeclaration } from '../../src/voice/types.js';

function createToolCall(callId: string, name: string, args: string): VoiceToolCallEvent {
  return { type: 'tool.call', id: callId, name, arguments: args };
}

describe('VoiceToolBridge', () => {

  it('初始时无活跃工具调用', () => {
    const bridge = new VoiceToolBridge();
    expect(bridge.getActiveTools().size).toBe(0);
    expect(bridge.getDeclarations()).toEqual([]);
  });

  it('setDelegate 缓存工具声明', () => {
    const bridge = new VoiceToolBridge();
    const delegate: ToolExecutorDelegate = {
      executeTool: async () => 'result',
      getToolDeclarations: () => [
        { name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: {} } },
      ],
    };

    bridge.setDelegate(delegate);
    expect(bridge.getDeclarations().length).toBe(1);
    expect(bridge.getDeclarations()[0].name).toBe('get_weather');
  });

  it('无委托时工具调用返回错误', async () => {
    const bridge = new VoiceToolBridge();
    const results: Array<{ id: string; output: string }> = [];

    bridge.setOnToolResult((id, output) => results.push({ id, output }));
    await bridge.onToolCall(createToolCall('call-1', 'test_tool', '{}'));

    expect(results.length).toBe(1);
    expect(results[0].output).toContain('未就绪');
  });

  it('工具执行成功触发结果回调', async () => {
    const bridge = new VoiceToolBridge();
    const delegate: ToolExecutorDelegate = {
      executeTool: async (_name, _input) => JSON.stringify({ result: 'ok' }),
      getToolDeclarations: () => [],
    };

    bridge.setDelegate(delegate);

    const results: Array<{ id: string; output: string }> = [];
    bridge.setOnToolResult((id, output) => results.push({ id, output }));

    await bridge.onToolCall(createToolCall('call-1', 'test', '{}'));

    expect(results.length).toBe(1);
    expect(JSON.parse(results[0].output)).toEqual({ result: 'ok' });
  });

  it('工具执行完成后从活跃列表移除', async () => {
    const bridge = new VoiceToolBridge();
    const delegate: ToolExecutorDelegate = {
      executeTool: async () => JSON.stringify({}),
      getToolDeclarations: () => [],
    };

    bridge.setDelegate(delegate);
    await bridge.onToolCall(createToolCall('call-2', 'test', '{}'));

    expect(bridge.getActiveTools().size).toBe(0);
  });

  it('工具异常触发错误结果回调', async () => {
    const bridge = new VoiceToolBridge();
    const delegate: ToolExecutorDelegate = {
      executeTool: async () => { throw new Error('exec error'); },
      getToolDeclarations: () => [],
    };

    bridge.setDelegate(delegate);

    const results: Array<{ id: string; output: string }> = [];
    bridge.setOnToolResult((id, output) => results.push({ id, output }));
    await bridge.onToolCall(createToolCall('call-3', 'fail', '{}'));

    expect(results[0].output).toContain('exec error');
  });

  it('工具进度回调被调用', async () => {
    const bridge = new VoiceToolBridge();
    const delegate: ToolExecutorDelegate = {
      executeTool: async () => JSON.stringify({}),
      getToolDeclarations: () => [],
    };

    bridge.setDelegate(delegate);

    const progress: Array<{ id: string; summary: string }> = [];
    bridge.setOnToolProgress((id, summary) => progress.push({ id, summary }));
    bridge.setOnToolResult(() => {});

    await bridge.onToolCall(createToolCall('call-4', 'test', '{}'));

    expect(progress.length).toBeGreaterThanOrEqual(1);
  });

  it('参数非 JSON 时以 _raw 传入', async () => {
    const bridge = new VoiceToolBridge();
    let receivedInput: Record<string, unknown> | null = null;
    const delegate: ToolExecutorDelegate = {
      executeTool: async (_name, input) => {
        receivedInput = input;
        return JSON.stringify({});
      },
      getToolDeclarations: () => [],
    };

    bridge.setDelegate(delegate);
    bridge.setOnToolResult(() => {});
    await bridge.onToolCall(createToolCall('call-5', 'test', 'not-json'));

    expect(receivedInput).toEqual({ _raw: 'not-json' });
  });

  it('工具超时触发错误结果', async () => {
    const bridge = new VoiceToolBridge(50);
    const delegate: ToolExecutorDelegate = {
      executeTool: async () => {
        await new Promise((r) => setTimeout(r, 200));
        return JSON.stringify({});
      },
      getToolDeclarations: () => [],
    };

    bridge.setDelegate(delegate);

    const results: Array<{ id: string; output: string }> = [];
    bridge.setOnToolResult((id, output) => results.push({ id, output }));
    bridge.onToolCall(createToolCall('call-6', 'slow', '{}'));

    await new Promise((r) => setTimeout(r, 150));

    expect(results.length).toBe(1);
    expect(results[0].output).toContain('超时');
  });
});
