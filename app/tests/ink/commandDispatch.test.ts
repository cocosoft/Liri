/**
 * 方案①（2026-10-16）：**ink REPL 接入 `commandExecutor`** —— 派发层单测。
 *
 * 背景（真机取证，本机 18990）：ink REPL（`app/src/ink/repl/ReplApp.tsx`）此前只处理硬编码的
 * `/help`、`/clear`、`/ink`、`/onboard`、`/router*`，其余 `/xxx`（如 `/budget`）会落到
 * `chatManager.streamMessage` 当**普通消息送进模型** —— 实测模型自述「该斜杠命令由应用层处理
 * （`app\src\commands\builtin\budget\Budget.ts`），当前消息落到了我这里」。修复后统一交全局
 * `commandExecutor`（与客户端 Terminal 页、非流式 HTTP 同一实现）。
 *
 * 为什么钉在 `commandDispatch` 而非 `ReplApp`：ink 渲染层在本仓无测试夹具（无伪终端、
 * 无 ink 测试库）⇒ 把"执行 + 整形 + 失败不抛"抽到不依赖 ink 的模块，才能真跑注册表验证。
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { initializeCommands } from '@modules/commands';
import { dispatchSlashCommand } from '../../src/ink/repl/commandDispatch';

describe('ink REPL 斜杠命令派发（方案①：接入 commandExecutor）', () => {
  beforeAll(async () => {
    await initializeCommands();
  });

  it('已注册命令 `/budget status` ⇒ 真执行并回命令自述文案（不再进模型）', async () => {
    const outcome = await dispatchSlashCommand('/budget status', 'ink-test');

    expect(outcome.ok).toBe(true);
    expect(outcome.text).toContain('每日预算限额');
  });

  it('整形口径：`message` 优先于 JSON —— 不得吐出 `{"type":"text",…}` 原始载荷', async () => {
    // `/budget` 的注册适配器把 `BudgetCommand.call()` 的 `value` 装进 `message`
    // （`builtin/budget/index.ts`）。若整形顺序写成 data(JSON) 优先，TUI 里会看到
    // `{"type":"text","value":"每日预算限额…"}` 而不是人读文案。
    const outcome = await dispatchSlashCommand('/budget status');

    expect(outcome.text.startsWith('每日预算限额')).toBe(true);
    expect(outcome.text).not.toContain('{"type"');
  });

  it('未注册命令 ⇒ `ok:false` 如实回报（不抛、不静默吞掉）', async () => {
    const outcome = await dispatchSlashCommand('/definitely-not-a-command');

    expect(outcome.ok).toBe(false);
    expect(outcome.text).toContain('❌');
    expect(outcome.text).toContain('definitely-not-a-command');
  });
});
