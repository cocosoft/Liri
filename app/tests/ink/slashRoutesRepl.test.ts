/**
 * `handleReplSlashInput` 的**分支识别与文案整形**特征化测试（T3 复杂度清理，2026-11-17）。
 *
 * 背景：这些分支原先内联在 `ReplApp.tsx` 的 `handleSubmit`（圈复杂度 66）里；ink 渲染层在
 * 本仓无测试夹具，按 `commandDispatch` 的既有先例把"识别 + 文案整形"抽成不依赖 ink 的模块
 * （`app/src/ink/repl/slashRoutes.ts`）后直接单测。
 *
 * 钉住的行为：
 *  ① `exit`/`quit` ⇒ 退出且不产生消息；`/clear` ⇒ 仅清空；
 *  ② `/help` 先回显用户输入，再回注册表文案 + Ink 快捷键说明（顺序不可颠倒）；
 *  ③ `/router*` 各分支归位（精确 `/router` 在前，带参分支在后），失败也有可读文案；
 *  ④ 其余 `/xxx` 透传命令执行器（带当前会话 id），结果以 `system` 消息落地；
 *  ⑤ 普通文本 ⇒ 返回 `false`（调用方继续走对话流），且不触碰任何 UI 副作用。
 *
 * 边界（如实）：本测试只锁"路由与文案"，不测 React 渲染；`dispatchSlashCommand` 用桩替换，
 * 不跑真实命令注册表（真实链路由 `tests/ink/commandDispatch.test.ts` 覆盖）。
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import * as commandDispatch from '../../src/ink/repl/commandDispatch';
import {
  handleReplSlashInput,
  type ReplSlashUi,
} from '../../src/ink/repl/slashRoutes';

interface Pushed {
  role: 'user' | 'system';
  idPrefix: string;
  content: string;
}

const spies: Array<{ mockRestore: () => void }> = [];

function stubDispatch(display: { ok: boolean; text: string }) {
  const s = spyOn(commandDispatch, 'dispatchSlashCommand').mockResolvedValue(
    display as never
  );
  spies.push(s as unknown as { mockRestore: () => void });
  return s as unknown as { mock: { calls: unknown[][] } };
}

afterEach(() => {
  for (const s of spies.splice(0, spies.length)) s.mockRestore();
});

function makeUi(overrides: Partial<ReplSlashUi> = {}) {
  const pushed: Pushed[] = [];
  const calls = { cleared: 0, exited: 0, onExit: 0 };
  const ui: ReplSlashUi = {
    pushMessage: (role, idPrefix, content) => {
      pushed.push({ role, idPrefix, content });
    },
    clearMessages: () => {
      calls.cleared++;
    },
    exit: () => {
      calls.exited++;
    },
    onExit: () => {
      calls.onExit++;
    },
    getSessionId: () => 'sess-1',
    ...overrides,
  };
  return { ui, pushed, calls };
}

describe('handleReplSlashInput：斜杠分支识别与文案（特征化）', () => {
  it('① exit / quit ⇒ 退出且不产生消息', async () => {
    const { ui, pushed, calls } = makeUi();

    expect(await handleReplSlashInput('exit', ui)).toBe(true);
    expect(await handleReplSlashInput('quit', ui)).toBe(true);

    expect(calls.exited).toBe(2);
    expect(calls.onExit).toBe(2);
    expect(pushed).toEqual([]);
  });

  it('① /clear ⇒ 只清空对话', async () => {
    const { ui, pushed, calls } = makeUi();

    expect(await handleReplSlashInput('/clear', ui)).toBe(true);

    expect(calls.cleared).toBe(1);
    expect(pushed).toEqual([]);
  });

  it('② /help ⇒ 先回显用户输入，再给注册表文案 + Ink 快捷键说明', async () => {
    const dispatch = stubDispatch({ ok: true, text: 'HELP-CMD-TEXT' });
    const { ui, pushed } = makeUi();

    expect(await handleReplSlashInput('/help', ui)).toBe(true);

    expect(dispatch.mock.calls).toHaveLength(1);
    expect(dispatch.mock.calls[0]![0]).toBe('/help');
    expect(pushed).toHaveLength(2);
    expect(pushed[0]).toMatchObject({ role: 'user', idPrefix: 'user' });
    expect(pushed[1]!.idPrefix).toBe('help');
    expect(pushed[1]!.content).toContain('HELP-CMD-TEXT');
    expect(pushed[1]!.content).toContain('快捷键（仅 Ink TUI）');
  });

  it('② /ink ⇒ 回显用户输入 + TUI 自述', async () => {
    const { ui, pushed } = makeUi();

    expect(await handleReplSlashInput('/ink', ui)).toBe(true);

    expect(pushed).toHaveLength(2);
    expect(pushed[0]!.idPrefix).toBe('user');
    expect(pushed[1]).toMatchObject({ role: 'system', idPrefix: 'ink-info' });
    expect(pushed[1]!.content).toContain('Liri Ink TUI');
  });

  it('③ /router 精确匹配 ⇒ 帮助文案（不被带参分支抢占）', async () => {
    const { ui, pushed } = makeUi();

    expect(await handleReplSlashInput('/router', ui)).toBe(true);

    expect(pushed).toHaveLength(2);
    expect(pushed[1]!.idPrefix).toBe('router-help');
    expect(pushed[1]!.content).toContain('/router config');
  });

  it('③ /router status ⇒ 单条 router-status 消息（成功或失败均有可读文案）', async () => {
    const { ui, pushed } = makeUi();

    expect(await handleReplSlashInput('/router status', ui)).toBe(true);

    expect(pushed).toHaveLength(2);
    expect(pushed[0]!.idPrefix).toBe('user');
    expect(pushed[1]!.idPrefix).toBe('router-status');
    expect(pushed[1]!.content.length).toBeGreaterThan(0);
  });

  it('③ /router on 与 /router off ⇒ 各产生一条 router-toggle 消息', async () => {
    const { ui, pushed } = makeUi();

    expect(await handleReplSlashInput('/router on', ui)).toBe(true);
    expect(await handleReplSlashInput('/router off', ui)).toBe(true);

    const toggles = pushed.filter((p) => p.idPrefix === 'router-toggle');
    expect(toggles).toHaveLength(2);
    expect(toggles[0]!.content.length).toBeGreaterThan(0);
  });

  it('③ /router config ⇒ 产生一条 router-config 消息', async () => {
    const { ui, pushed } = makeUi();

    expect(await handleReplSlashInput('/router config', ui)).toBe(true);

    const configs = pushed.filter((p) => p.idPrefix === 'router-config');
    expect(configs).toHaveLength(1);
    expect(configs[0]!.role).toBe('system');
  });

  it('④ 其余 /xxx ⇒ 透传命令执行器（带会话 id），结果落为 system 消息', async () => {
    const dispatch = stubDispatch({ ok: false, text: '❌ 未注册命令' });
    const { ui, pushed } = makeUi();

    expect(await handleReplSlashInput('/budget status', ui)).toBe(true);

    expect(dispatch.mock.calls).toHaveLength(1);
    expect(dispatch.mock.calls[0]![0]).toBe('/budget status');
    expect(dispatch.mock.calls[0]![1]).toBe('sess-1');
    expect(pushed).toHaveLength(2);
    expect(pushed[1]).toMatchObject({
      role: 'system',
      idPrefix: 'command',
      content: '❌ 未注册命令',
    });
  });

  it('⑤ 普通文本 ⇒ false，且不产生任何 UI 副作用', async () => {
    const dispatch = stubDispatch({ ok: true, text: 'unused' });
    const { ui, pushed, calls } = makeUi();

    expect(await handleReplSlashInput('你好，介绍一下自己', ui)).toBe(false);

    expect(pushed).toEqual([]);
    expect(calls).toEqual({ cleared: 0, exited: 0, onExit: 0 });
    expect(dispatch.mock.calls).toHaveLength(0);
  });
});
