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
  flags: { boost: boolean; supersede: boolean; phaseCompactionFailed: boolean };
}

function makeDeps(): Harness {
  const messages: Record<string, unknown>[] = [];
  const retries: IncompleteRetries = { ...INITIAL_INCOMPLETE_RETRIES };
  const flags = {
    boost: false,
    supersede: false,
    phaseCompactionFailed: false,
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
  };
  return { deps, retries, messages, flags };
}

function truncatedResult(
  partialToolCalls?: ToolCallEntry[]
): ReasonResult<ToolLoopContext> {
  return {
    text: '',
    toolCalls: [],
    finishReason: 'max_tokens',
    ...(partialToolCalls ? { partialToolCalls } : {}),
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
