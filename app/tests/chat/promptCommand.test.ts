/**
 * prompt 型斜杠命令的展开（2026-10-22）
 *
 * 缺陷现场：`ChatOrchestrator._handleCommand` 对所有 `/xxx` 一律走 `commandExecutor.execute()`
 * 并短路本轮模型调用；而 `security-review` / `plan` / `review` 这类命令的**执行体**是
 * `getPromptForCommand()`（产出给模型的提示词）⇒ GUI/渠道里打 `/security-review` 只回一段
 * "本命令需要在对话中由 AI 执行"的用法文案，审查永远不会开始。
 *
 * 本用例锁三件事：
 *  ① 只有 `type:'prompt'` 且实现 `getPromptForCommand` 的命令才展开（其余保持旧短路行为）；
 *  ② 展开失败/为空不得吞掉本轮对话（返回 null，由调用方按普通命令处理）；
 *  ③ 合并运行时补充时，**原有内容必须保留在前**（通道投递契约等不能被覆盖）。
 */
import { describe, it, expect } from 'bun:test';

import {
  expandPromptCommand,
  mergeRuntimeNote,
  parseSlashCommand,
  type PromptCommandLike,
} from '../../src/chat/orchestrator/promptCommand';

function sourceOf(commands: Record<string, PromptCommandLike>): {
  getCommand(name: string): PromptCommandLike | undefined;
} {
  return { getCommand: (name) => commands[name] };
}

describe('parseSlashCommand', () => {
  it('拆出命令名与参数', () => {
    expect(parseSlashCommand('/security-review')).toEqual({
      name: 'security-review',
      args: '',
    });
    expect(parseSlashCommand('/security-review main')).toEqual({
      name: 'security-review',
      args: 'main',
    });
    expect(parseSlashCommand('  /advisor code ./a.ts  ')).toEqual({
      name: 'advisor',
      args: 'code ./a.ts',
    });
  });

  it('非斜杠输入不算命令', () => {
    expect(parseSlashCommand('hello')).toBeNull();
    expect(parseSlashCommand('/ security-review')).toBeNull();
    expect(parseSlashCommand('')).toBeNull();
  });
});

describe('expandPromptCommand', () => {
  it('prompt 型：返回展开后的提示词（数组按空行拼接）', async () => {
    const source = sourceOf({
      'security-review': {
        type: 'prompt',
        getPromptForCommand: async () => [
          { type: 'text', text: '你是安全工程师' },
          { type: 'text', text: '请审查 diff' },
        ],
      },
    });

    const result = await expandPromptCommand('/security-review main', source);
    expect(result).toEqual({
      ok: true,
      name: 'security-review',
      prompt: '你是安全工程师\n\n请审查 diff',
    });
  });

  it('字符串返回值同样接受', async () => {
    const source = sourceOf({
      plan: { type: 'prompt', getPromptForCommand: () => '只规划不执行' },
    });
    const result = await expandPromptCommand('/plan', source);
    expect(result).toEqual({ ok: true, name: 'plan', prompt: '只规划不执行' });
  });

  it('非 prompt 型 / 未注册 ⇒ 不展开（调用方继续走命令短路）', async () => {
    const source = sourceOf({
      effort: { type: 'action' },
      fast: {
        type: 'local',
        getPromptForCommand: () => '不应被使用',
      },
    });
    expect((await expandPromptCommand('/effort high', source)).ok).toBe(false);
    expect((await expandPromptCommand('/fast on', source)).ok).toBe(false);
    expect((await expandPromptCommand('/nope', source)).ok).toBe(false);
    expect((await expandPromptCommand('普通消息', source)).ok).toBe(false);
  });

  it('prompt 型但无实现 ⇒ 不展开', async () => {
    const source = sourceOf({ broken: { type: 'prompt' } });
    const result = await expandPromptCommand('/broken', source);
    expect(result).toEqual({ ok: false, name: 'broken' });
  });

  it('懒加载命令（LazyCommand）：实现上的 getPromptForCommand 同样生效', async () => {
    // 生产形态：CommandLoader 把命令登记为 type:'prompt'，真正的提示词挂在 load() 的实现上
    const source = sourceOf({
      'security-review': {
        type: 'prompt',
        load: async () => ({
          getPromptForCommand: (args: string) =>
            `审查提示词 target=${args || 'origin/HEAD'}`,
        }),
      },
    });
    const result = await expandPromptCommand('/security-review main', source);
    expect(result).toEqual({
      ok: true,
      name: 'security-review',
      prompt: '审查提示词 target=main',
    });
  });

  it('懒加载失败 ⇒ 返回 error（调用方按普通命令处理，不阻断对话）', async () => {
    const source = sourceOf({
      'security-review': {
        type: 'prompt',
        load: async () => {
          throw new Error('module not found');
        },
      },
    });
    expect(await expandPromptCommand('/security-review', source)).toEqual({
      ok: false,
      name: 'security-review',
      error: 'module not found',
    });
  });

  it('展开为空 ⇒ 不展开（不注入空补充）', async () => {
    const source = sourceOf({
      blank: { type: 'prompt', getPromptForCommand: () => '   ' },
    });
    expect((await expandPromptCommand('/blank', source)).ok).toBe(false);
  });

  it('展开抛错 ⇒ 返回 error 交由调用方记日志，不向用户抛', async () => {
    const source = sourceOf({
      boom: {
        type: 'prompt',
        getPromptForCommand: () => {
          throw new Error('boom');
        },
      },
    });
    const result = await expandPromptCommand('/boom', source);
    expect(result).toEqual({ ok: false, name: 'boom', error: 'boom' });
  });
});

describe('mergeRuntimeNote', () => {
  it('原有内容保留在前，命令提示词追加在后', () => {
    expect(mergeRuntimeNote('通道契约', '安全审查提示')).toBe(
      '通道契约\n\n安全审查提示'
    );
  });

  it('原为空/空白 ⇒ 直接用命令提示词', () => {
    expect(mergeRuntimeNote(undefined, 'x')).toBe('x');
    expect(mergeRuntimeNote('   ', 'x')).toBe('x');
  });
});
