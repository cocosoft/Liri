import type { Companion, StatName } from './types';
import { getBuddyMemoryPort } from './memoryPort';

export type InteractionAction = 'pet' | 'feed' | 'play' | 'talk' | 'compliment';

export interface InteractionResult {
  action: InteractionAction;
  companionId: string;
  timestamp: number;
  response: string;
  statChanges: Partial<Record<StatName, number>>;
  affectionChange: number;
}

export interface InteractionEntry {
  action: InteractionAction;
  timestamp: number;
  response: string;
  statChanges: Partial<Record<StatName, number>>;
  affectionChange: number;
}

export interface InteractionHistory {
  companionId: string;
  entries: InteractionEntry[];
}

const RESPONSES: Record<InteractionAction, string[]> = {
  pet: [
    'purrs happily',
    'leans into your hand',
    'closes its eyes in contentment',
    'makes a soft appreciative sound',
  ],
  feed: [
    'munches enthusiastically',
    'nibbles carefully from your hand',
    'looks up at you with gratitude',
    'savors every bite',
  ],
  play: [
    'bounces around excitedly',
    'chases after the toy with glee',
    'pounces with dramatic flair',
    'tumbles over itself mid-play',
  ],
  talk: [
    'listens attentively and tilts its head',
    'responds with an encouraging chirp',
    'nuzzles closer as you speak',
    'gazes at you with understanding eyes',
  ],
  compliment: [
    'puffs up with visible pride',
    'does a little happy dance',
    'glows warmly at your words',
    'preens modestly while blushing',
  ],
};

const STAT_EFFECTS: Record<
  InteractionAction,
  Partial<Record<StatName, number>>
> = {
  pet: { WISDOM: 1, SNARK: -1 },
  feed: { PATIENCE: 2 },
  play: { CHAOS: 2, DEBUGGING: -1 },
  talk: { WISDOM: 2, PATIENCE: 1 },
  compliment: { SNARK: -1, WISDOM: 1 },
};

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 交互动作归一（2026-11-25）
 *
 * 输入框把用户原文本直接作为 action 提交（`BuddyPage.tsx` / `LiriPage.tsx`），
 * 旧实现按未知 key 取 `RESPONSES[action]` ⇒ `pickRandom(undefined)` 抛错。
 * 这里把「非动作词汇」一律视为 `talk`（对话），合法动作原样返回。
 */
export function normalizeInteractionAction(raw: string): InteractionAction {
  return Object.prototype.hasOwnProperty.call(RESPONSES, raw)
    ? (raw as InteractionAction)
    : 'talk';
}

/** talk 时引用的记忆条数（只做"一句回忆"，不做记忆面板） */
const MAX_MEMORY_ECHOES = 1;
/** 回忆句最大字符数（避免长描述灌进交互气泡） */
const MAX_ECHO_CHARS = 60;

/**
 * talk 交互的「记忆回响」（P2-1，2026-11-25）
 *
 * 端口由 app 组合根注入（`setBuddyMemoryPort`）；未注入 / 无记忆 / 描述为空
 * ⇒ `null`（**不伪造记忆**，行为与接线前一致）。
 */
async function buildMemoryEcho(): Promise<string | null> {
  const port = getBuddyMemoryPort();
  if (!port) return null;
  const [memory] = await port.getRecentMemories(MAX_MEMORY_ECHOES);
  if (!memory) return null;
  const summary = (memory.description || memory.name).trim();
  if (!summary) return null;
  return `It recalls: ${summary.slice(0, MAX_ECHO_CHARS)}`;
}

export class InteractionManager {
  private histories = new Map<string, InteractionEntry[]>();
  private readonly maxHistoryPerCompanion = 100;

  async execute(
    companion: Companion,
    action: string
  ): Promise<InteractionResult> {
    // 边界归一：HTTP 入参可能是用户输入框原文（非动作词汇）⇒ 按 talk 处理
    const resolved = normalizeInteractionAction(action);
    const timestamp = Date.now();
    const baseResponse = pickRandom(RESPONSES[resolved]);
    // P2-1：talk 时引用一条真实记忆（端口未注入 ⇒ 不追加）
    const memoryEcho = resolved === 'talk' ? await buildMemoryEcho() : null;
    const response = memoryEcho
      ? `${baseResponse} — ${memoryEcho}`
      : baseResponse;
    const statChanges = { ...STAT_EFFECTS[resolved] };
    const affectionChange =
      resolved === 'compliment' ? 3 : resolved === 'pet' ? 2 : 1;

    const entry: InteractionEntry = {
      action: resolved,
      timestamp,
      response,
      statChanges,
      affectionChange,
    };

    const id = companion.name;
    let history = this.histories.get(id);
    if (!history) {
      history = [];
      this.histories.set(id, history);
    }
    history.push(entry);
    if (history.length > this.maxHistoryPerCompanion) {
      history.splice(0, history.length - this.maxHistoryPerCompanion);
    }

    return {
      action: resolved,
      companionId: id,
      timestamp,
      response,
      statChanges,
      affectionChange,
    };
  }

  getAvailableInteractions(_companion: Companion): InteractionAction[] {
    return Object.keys(RESPONSES) as InteractionAction[];
  }

  trackInteractionHistory(companionId: string): InteractionHistory {
    return {
      companionId,
      entries: [...(this.histories.get(companionId) ?? [])],
    };
  }

  getInteractionCount(companionId: string): number {
    return this.histories.get(companionId)?.length ?? 0;
  }
}
