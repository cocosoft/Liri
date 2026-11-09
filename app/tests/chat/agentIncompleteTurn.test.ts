// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * N-1（2026-11-06 真机长程任务）：截断发生在 `file_write` 参数里时，续接指令必须**带上写入目标**。
 *
 * 真机证据（`session_mw4vwtmp38957bec2f`，超级玛丽 1-1）：
 * - 11:23:30Z / 11:26:27Z 两次 `reactToolLoop:incomplete_turn_retry kind=truncated`；
 * - 原来的截断续接文案是通用句（"从输出中断处继续"），模型重试时**丢掉写入目标**——
 *   第二次直接改做 `dir /b`，`game.js` 永远没写出来；
 * - 最终 `output/mario/` 只有 `index.html` + `style.css`，`<script src="game.js">` 404。
 *
 * 本组钉住：能识别出半截 `file_write` 的目标时，续接指令给出**文件名 + 分块写入方式 + 禁止改做探索**；
 * 识别不到时回落通用文案（不臆造、不误伤其它工具）。
 */
import { describe, expect, it } from 'bun:test';

import {
  INITIAL_INCOMPLETE_RETRIES,
  onIncompleteTurn,
  type AgentIncompleteTurnDeps,
  type IncompleteRetries,
} from '../../src/chat/agentIncompleteTurn.js';
import type { ReasonResult, ToolCallEntry } from '../../src/query/ReActLoop.js';
import type { ToolLoopContext } from '../../src/chat/ToolLoopRunner.js';
import { CONTINUATION_TEMPLATES } from '@openliri/infra/constants/goalTemplates';

const FILE_PATH = 'E:\\PY\\Documents\\CODES\\PY_APP\\output\\mario\\game.js';

/** 半截 JSON（真机形态：content 写到一半被 max_tokens 截断） */
const partialWriteArgs = {
  _raw: `{"file_path":"E:\\\\PY\\\\Documents\\\\CODES\\\\PY_APP\\\\output\\\\mario\\\\game.js","content":"const canvas = document`,
  _partial: true,
};

interface Harness {
  deps: AgentIncompleteTurnDeps;
  retries: IncompleteRetries;
  messages: Record<string, unknown>[];
  flags: {
    boost: boolean;
    supersede: boolean;
    phaseCompactionFailed: boolean;
    phaseOutputBudgetExhausted: boolean;
  };
}

function makeDeps(): Harness {
  const messages: Record<string, unknown>[] = [];
  const retries: IncompleteRetries = { ...INITIAL_INCOMPLETE_RETRIES };
  const flags = {
    boost: false,
    supersede: false,
    phaseCompactionFailed: false,
    phaseOutputBudgetExhausted: false,
  };
  const deps: AgentIncompleteTurnDeps = {
    sessionId: 'sess-n1',
    phase: 'reasoning',
    droppedToolCallsAtStop: 0,
    lastRoundHadThinking: false,
    convergeSteeringPrompted: false,
    compactionStalled: false,
    messages,
    setTerminalSettle: () => {},
    settleGoalForTurnNow: async () => {},
    incompleteRetries: retries,
    setBoostNextReasonMaxTokens: (v) => {
      flags.boost = v;
    },
    setSupersedeNextRoundText: (v) => {
      flags.supersede = v;
    },
    setPhaseCompactionFailed: () => {
      flags.phaseCompactionFailed = true;
    },
    setPhaseOutputBudgetExhausted: () => {
      flags.phaseOutputBudgetExhausted = true;
    },
  };
  return { deps, retries, messages, flags };
}

function truncatedResult(
  partialToolCalls?: ToolCallEntry[],
  thinkingRatio?: number
): ReasonResult<ToolLoopContext> {
  return {
    text: '',
    toolCalls: [],
    finishReason: 'max_tokens',
    ...(partialToolCalls ? { partialToolCalls } : {}),
    ...(thinkingRatio !== undefined ? { thinkingRatio } : {}),
  };
}

/** 取最后一条注入的续接指令正文 */
function lastInstruction(messages: Record<string, unknown>[]): string {
  return String(messages[messages.length - 1]?.content ?? '');
}

describe('N-1：截断发生在 file_write 参数里 ⇒ 续接指令带上写入目标', () => {
  it('★ 半截 file_write ⇒ 指令包含目标文件 + 分块 append + 禁止改做探索', async () => {
    const h = makeDeps();
    const handled = await onIncompleteTurn(
      truncatedResult([
        { id: 'call_00', name: 'file_write', input: partialWriteArgs },
      ]),
      h.deps
    );

    expect(handled).toBe(true);
    const instruction = lastInstruction(h.messages);
    expect(instruction).toContain(FILE_PATH);
    expect(instruction).toContain('append:true');
    expect(instruction).toContain('分块');
    // 不能是通用截断文案（那正是"丢目标"的那条）
    expect(instruction).not.toBe(CONTINUATION_TEMPLATES.truncated);
    // 截断续接仍要放大下一轮输出预算
    expect(h.flags.boost).toBe(true);
    expect(h.retries.truncated).toBe(1);
  });

  it('负向对照：没有半截工具调用 ⇒ 回落通用截断文案', async () => {
    const h = makeDeps();
    await onIncompleteTurn(truncatedResult(), h.deps);

    expect(lastInstruction(h.messages)).toContain(
      CONTINUATION_TEMPLATES.truncated.slice(0, 12)
    );
  });

  it('负向对照：半截的是别的工具（bash）⇒ 不臆造写入目标，仍走通用文案', async () => {
    const h = makeDeps();
    await onIncompleteTurn(
      truncatedResult([
        {
          id: 'call_01',
          name: 'bash',
          input: { _raw: '{"command":"node --che' },
        },
      ]),
      h.deps
    );

    const instruction = lastInstruction(h.messages);
    expect(instruction).toContain(
      CONTINUATION_TEMPLATES.truncated.slice(0, 12)
    );
    expect(instruction).not.toContain('append:true');
  });

  it('负向对照：file_write 的半截参数里取不到 file_path ⇒ 通用文案（不编造路径）', async () => {
    const h = makeDeps();
    await onIncompleteTurn(
      truncatedResult([
        {
          id: 'call_02',
          name: 'file_write',
          input: { _raw: '{"content":"写了' },
        },
      ]),
      h.deps
    );

    expect(lastInstruction(h.messages)).toContain(
      CONTINUATION_TEMPLATES.truncated.slice(0, 12)
    );
  });
});

/**
 * N-11（2026-11-06 真机长程任务）：空回复允许**两次**续接，第二次换成硬指令。
 *
 * 真机证据：同一任务 3 轮里 3 次"零可见输出"；旧实现每类只重试 1 次 ⇒ 第一次重试仍空时
 * 直接落兜底文案，回合"看着结束、其实没交付"。
 */
describe('N-11：空回复的两次续接', () => {
  const emptyResult = (): ReasonResult<ToolLoopContext> => ({
    text: '',
    toolCalls: [],
    finishReason: 'stop',
  });

  it('第 1 次空回复 ⇒ 通用续接文案，仍接管', async () => {
    const h = makeDeps();
    expect(await onIncompleteTurn(emptyResult(), h.deps)).toBe(true);

    expect(lastInstruction(h.messages)).toContain(
      CONTINUATION_TEMPLATES.empty.slice(0, 12)
    );
    expect(h.retries.empty).toBe(1);
  });

  it('★ 第 2 次空回复 ⇒ 换成「只做一件事」硬指令（不再重复通用文案）', async () => {
    const h = makeDeps();
    await onIncompleteTurn(emptyResult(), h.deps);
    expect(await onIncompleteTurn(emptyResult(), h.deps)).toBe(true);

    const instruction = lastInstruction(h.messages);
    expect(instruction).toContain('只做一件事');
    expect(instruction).not.toContain(
      CONTINUATION_TEMPLATES.empty.slice(0, 12)
    );
    expect(h.retries.empty).toBe(2);
  });

  it('第 3 次空回复 ⇒ 放手（落兜底文案，不死循环）', async () => {
    const h = makeDeps();
    await onIncompleteTurn(emptyResult(), h.deps);
    await onIncompleteTurn(emptyResult(), h.deps);
    expect(await onIncompleteTurn(emptyResult(), h.deps)).toBe(false);
    expect(h.retries.empty).toBe(2);
  });
});

/**
 * N-13（2026-11-06 真机长程任务）：截断发生在**推理阶段**（预算被思考耗尽）时的定向续接。
 *
 * 真机证据：三次长程任务都在写大文件前被 `max_tokens` 截断，且 `partial_tool_calls` 为空
 * （正文/参数根本没开始写），`thinkingChunkCount` 远大于 `textChunkCount`。旧实现只给通用
 * 截断文案（"从断点继续"），模型会再想一遍、再次耗光预算；且 `truncated` 只有 1 次额度，
 * 第二次截断时**静默**落兜底。
 */
describe('N-13：推理型截断的续接与额度', () => {
  it('★ 推理占比 ≥0.8 且无半截调用 ⇒ 换用"停止推理"指令', async () => {
    const h = makeDeps();
    const handled = await onIncompleteTurn(
      truncatedResult(undefined, 0.95),
      h.deps
    );

    expect(handled).toBe(true);
    const instruction = lastInstruction(h.messages);
    expect(instruction).toContain('推理阶段');
    expect(instruction).toContain('停止继续推理');
    expect(h.retries.truncated).toBe(1);
  });

  it('负向对照：推理占比低（正文写了一半）⇒ 仍用通用截断文案', async () => {
    const h = makeDeps();
    await onIncompleteTurn(truncatedResult(undefined, 0.2), h.deps);

    const instruction = lastInstruction(h.messages);
    expect(instruction).toContain(
      CONTINUATION_TEMPLATES.truncated.slice(0, 12)
    );
    expect(instruction).not.toContain('停止继续推理');
  });

  it('负向对照：有半截 file_write ⇒ 定向续写优先于推理型文案', async () => {
    const h = makeDeps();
    await onIncompleteTurn(
      truncatedResult(
        [{ id: 'call_00', name: 'file_write', input: partialWriteArgs }],
        0.95
      ),
      h.deps
    );

    const instruction = lastInstruction(h.messages);
    expect(instruction).toContain(FILE_PATH);
    expect(instruction).not.toContain('停止继续推理');
  });

  it('★ 第 3 次截断 ⇒ 放手 + 置 output_budget_exhausted 相位（不再静默）', async () => {
    const h = makeDeps();
    await onIncompleteTurn(truncatedResult(undefined, 0.9), h.deps);
    await onIncompleteTurn(truncatedResult(undefined, 0.9), h.deps);
    expect(h.retries.truncated).toBe(2);

    expect(
      await onIncompleteTurn(truncatedResult(undefined, 0.9), h.deps)
    ).toBe(false);
    expect(h.flags.phaseOutputBudgetExhausted).toBe(true);
  });
});

/**
 * 2026-11-09（真机 SMOKE，deepseek-v4-flash 非流式工具轮）：**内联思考不得判成空回复**。
 *
 * 该模型把思考内联在 `content` 里（`<think>…</think>`）而不发 thinking chunk ⇒
 * `lastRoundHadThinking` 恒为 false，旧判据把「只思考、无可见答案」当「空回复」，
 * 注入的是 `empty` 文案（让模型"再输出一次"），而不是 `reasoning` 文案（"别只想着，给结论"）。
 * 真机表现：`taorLoop:incomplete_turn_retry kind="empty" textPreview=""`。
 */
describe('内联 `<think>` 正文 ⇒ 归为 reasoning（不是 empty）', () => {
  const inlineThink = (think: string): ReasonResult<ToolLoopContext> => ({
    text: `<think>${think}</think>`,
    toolCalls: [],
    finishReason: 'stop',
  });

  it('★ 正文只有内联 think ⇒ reasoning 文案，且 consumed 的是 reasoning 额度', async () => {
    const h = makeDeps();
    const handled = await onIncompleteTurn(
      inlineThink('先想一下该调哪个工具'),
      h.deps
    );

    expect(handled).toBe(true);
    expect(h.retries.reasoning).toBe(1);
    expect(h.retries.empty).toBe(0);
    expect(lastInstruction(h.messages)).toContain(
      CONTINUATION_TEMPLATES.reasoning
    );
  });

  it('负向对照：正文真的为空 ⇒ 仍是 empty（不误伤真空转）', async () => {
    const h = makeDeps();
    await onIncompleteTurn(
      { text: '', toolCalls: [], finishReason: 'stop' },
      h.deps
    );

    expect(h.retries.empty).toBe(1);
    expect(h.retries.reasoning).toBe(0);
    expect(lastInstruction(h.messages)).toContain(CONTINUATION_TEMPLATES.empty);
  });

  it('负向对照：有可见正文 ⇒ 不接管（正常回答零打扰）', async () => {
    const h = makeDeps();
    const handled = await onIncompleteTurn(
      {
        text: '<think>x</think>已经写好 smoke/a.txt',
        toolCalls: [],
        finishReason: 'stop',
      },
      h.deps
    );

    expect(handled).toBe(false);
    expect(h.messages.length).toBe(0);
  });
});
