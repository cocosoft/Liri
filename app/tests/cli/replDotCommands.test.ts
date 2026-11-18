// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// REPL 点命令与命令结果输出特征化（P3-2，2026-11-16）
//
// 这三段原本内联在 `rl.on('line')` 的异步箭头里（复杂度 54）。判错只表现为
// 「场景/模型切换不生效」「命令结果不显示」（不报错）⇒ 外移前先按文案与写配置参数钉住。
//
// 注入方式：两个点命令的依赖（配置读写 / 模型读写）以**端口参数**传入，测试直接给假端口。
// 不用模块级 mock，也不用 spyOn 全局 configManager（它是对 Proxy 的导出：访问会返回
// 绑定后的函数，打桩既拿不到调用记录也无法可靠还原）。
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import {
  handleModelCommand,
  handleSceneCommand,
  reportCommandResult,
} from '../../src/entrypoints/repl';

type UiCall = string;

/** 最小 UI 替身：只记录三类提示 */
function makeUi(): { calls: UiCall[]; ui: never } {
  const calls: UiCall[] = [];
  return {
    calls,
    ui: {
      showInfo: (m: string) => calls.push(`info:${m}`),
      showSuccess: (m: string) => calls.push(`success:${m}`),
      showError: (m: string) => calls.push(`error:${m}`),
    } as never,
  };
}

/** 假配置端口：读固定值，写只记录 */
function makeConfig(readValue: unknown): {
  writes: Array<{ key: string; value: unknown }>;
  port: never;
} {
  const writes: Array<{ key: string; value: unknown }> = [];
  return {
    writes,
    port: {
      getConfigValue: (_key: string) => readValue,
      setConfigValue: (key: string, value: unknown) => {
        writes.push({ key, value });
      },
    } as never,
  };
}

/** 假模型端口 */
function makeRouter(current: string | null): {
  sets: string[];
  port: never;
} {
  const sets: string[] = [];
  return {
    sets,
    port: {
      getCurrentModel: () => current,
      setCurrentModel: async (model: string) => {
        sets.push(model);
      },
    } as never,
  };
}

describe('handleSceneCommand：查看当前场景', () => {
  it('未配置 ⇒ 显示未设置 + 用法提示', () => {
    const { calls, ui } = makeUi();
    handleSceneCommand('.scene', ui, makeConfig(undefined).port);
    expect(calls).toEqual([
      'info:当前场景: 未设置',
      'info:使用 /scene <chat|work|development> 切换场景',
    ]);
  });

  it('已配置 work ⇒ 显示中文标签与原始值', () => {
    const { calls, ui } = makeUi();
    handleSceneCommand(
      '.scene ',
      ui,
      makeConfig({ defaultTrustLevel: 'work' }).port
    );
    expect(calls[0]).toBe('info:当前场景: 工作 (work)');
  });
});

describe('handleSceneCommand：切换场景', () => {
  it('合法级别 ⇒ 合并写入 permission.defaultTrustLevel 并提示成功', () => {
    const { writes, port } = makeConfig({ existing: 1 });
    const { calls, ui } = makeUi();
    handleSceneCommand('.scene chat', ui, port);

    expect(writes).toEqual([
      {
        key: 'permission',
        value: { existing: 1, defaultTrustLevel: 'chat' },
      },
    ]);
    expect(calls).toEqual(['success:场景已切换至: 聊天 (chat)']);
  });

  it('非法级别 ⇒ 报错列出可选值，且不写配置', () => {
    const { writes, port } = makeConfig(undefined);
    const { calls, ui } = makeUi();
    handleSceneCommand('.scene bogus', ui, port);
    expect(calls).toEqual([
      'error:无效场景: bogus。可选: chat, work, development',
    ]);
    expect(writes).toEqual([]);
  });
});

describe('handleModelCommand：查看当前模型', () => {
  it('未设置 ⇒ 显示 (未设置)', async () => {
    const { calls, ui } = makeUi();
    await handleModelCommand('.model ', ui, makeRouter(null).port);
    expect(calls).toEqual(['info:当前模型: (未设置)']);
  });

  it('已设置 ⇒ 显示当前模型', async () => {
    const { calls, ui } = makeUi();
    await handleModelCommand('.model ', ui, makeRouter('gpt-x').port);
    expect(calls).toEqual(['info:当前模型: gpt-x']);
  });
});

describe('reportCommandResult：成功输出降级顺序', () => {
  let logs: string[] = [];
  let restoreLog: (() => void) | undefined;

  beforeEach(() => {
    logs = [];
    const spy = spyOn(console, 'log').mockImplementation(((
      ...args: unknown[]
    ) => {
      logs.push(args.map(String).join(' '));
    }) as never);
    // 必须显式 mockRestore：直接调用 spy 只会执行被替换的实现，不会还原 console.log
    restoreLog = () => spy.mockRestore();
  });

  afterEach(() => {
    restoreLog?.();
    restoreLog = undefined;
  });

  it('message 优先，其次 value，最后 data(JSON)', () => {
    const { ui } = makeUi();
    reportCommandResult(
      { success: true, message: 'm', value: 'v', data: { a: 1 } } as never,
      ui
    );
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('m');

    logs = [];
    reportCommandResult(
      { success: true, value: 'v', data: { a: 1 } } as never,
      ui
    );
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('v');

    logs = [];
    reportCommandResult({ success: true, data: { a: 1 } } as never, ui);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('"a": 1');
  });

  it('成功但三者皆空 ⇒ 不打印', () => {
    const { ui } = makeUi();
    reportCommandResult({ success: true } as never, ui);
    expect(logs).toEqual([]);
  });
});

describe('reportCommandResult：失败提示', () => {
  it('失败 ⇒ 报错文案优先取 error', () => {
    const { calls, ui } = makeUi();
    reportCommandResult({ success: false, error: '出错了' } as never, ui);
    expect(calls).toEqual(['error:出错了']);
  });

  it('失败且无 error ⇒ 兜底文案', () => {
    const { calls, ui } = makeUi();
    reportCommandResult({ success: false } as never, ui);
    expect(calls).toEqual(['error:命令执行失败']);
  });

  it('Command not found ⇒ 追加 /help 提示', () => {
    const { calls, ui } = makeUi();
    reportCommandResult(
      { success: false, error: 'Command not found: foo' } as never,
      ui
    );
    expect(calls).toEqual([
      'error:Command not found: foo',
      'info:提示: 使用 /help 查看可用命令',
    ]);
  });
});
