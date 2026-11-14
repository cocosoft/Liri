// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 事件流 thinking 瘦身（C，2026-10-30）——「按轮保留」的唯一实现。
 *
 * **为什么**：`events.jsonl` 实测 29 文件 / 196.8 MB，其中 `assistant/thinking`
 * **53.4 MB（27.1% 体积）/ 150,425 行（47.9% 行数）**，且写入侧仍是**逐 chunk 一条**
 * （最大会话 230 条消息、thinking 中位 **70 条/消息**）。体积集中在 0–5 天内的活跃会话，
 * 因此**按龄清理无效**（>30 天的文件为 0，且 `SessionPruner` 已在 30 天删整个会话）。
 *
 * **口径**：对**已空闲**的会话，保留最近 `keepTurns` 轮的 thinking，清理**更早轮次**的
 * `assistant/thinking` 事件；其余事件（turn/user/assistant/text/tool/metric…）一律不动。
 *
 * **消费者边界（CD05/CD07 核查结论，2026-10-30）**：
 *  - 派生读 `_loadDerivationEvents` 本就 `excludeTypes: ['assistant/thinking']` ⇒ 消息、轮次摘要、
 *    首屏分页**逐字节不变**；`ReconcileService` 只比对 `content`（thinking 不进 content）⇒ 无影响；
 *  - 会感知退化的只有「轨迹页/日志页（`GET /v1/sessions/:id/events`）、事件导出、W5 时间旅行」——
 *    旧轮次不再有思考过程；`/stats` 的 `eventCount` 下降、`assistantMessageCount` 仅在
 *    「只有 thinking 的消息」上少计（全库实测 **3 条**）。
 *
 * **不变量（破坏任一即拒绝写盘）**：
 *  ① 只删 `assistant/thinking` 行；解析不出 JSON 的行**原样保留**（不拿"坏行"当清理对象）；
 *  ② `seq` **不重排**（保留原值，允许出现空洞）⇒ `events.tail`、投影 `lastEventSeq`、压缩区间
 *     与 `tool/result.callSeq` 的引用全部继续有效；
 *  ③ **最大 seq 那一行永不删**（保证 `getTailSeq()` 前后一致 ⇒ 不会复用已删除的 seq）；
 *  ④ 无 `turn/start` 的会话（v0 legacy）**一律不动** —— 无法归轮就不猜；
 *  ⑤ 写盘用「临时文件 + rename」原子替换；替换后**删除派生物 `events.idx`**
 *     （字节偏移全部失效，留着会让读侧 seek 到行中间），`events.tail` 重写为最大 seq。
 *
 * **调度**：一次性运维脚本（`scripts/prune-event-thinking.ts`，默认预演，`--apply` 才写盘；
 * 先备份 + `audit.jsonl`），**不进** `ArtifactRetention` 的 5 分钟节拍 —— 事件流是真源，
 * 不在活跃进程里改写。
 */

import {
  existsSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';

/** 默认保留的最近轮数（更早轮次的 thinking 可清理） */
export const DEFAULT_THINKING_KEEP_TURNS = 10;

/** 默认空闲阈值（分钟）：`events.jsonl` 在该窗口内被写过 ⇒ 视为活跃，跳过 */
export const DEFAULT_THINKING_IDLE_MINUTES = 30;

const THINKING_TYPE = 'assistant/thinking';
const TURN_START_TYPE = 'turn/start';

/** 单行事件的**最小读取面**（只解析判定所需的字段） */
interface ParsedEventLine {
  type?: string;
  seq?: number;
  turn?: number;
}

/** 解析一行事件；坏行返回 `null`（调用方必须原样保留） */
function parseEventLine(line: string): ParsedEventLine | null {
  try {
    const parsed = JSON.parse(line) as {
      type?: unknown;
      seq?: unknown;
      data?: { turn?: unknown };
    };
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      ...(typeof parsed.type === 'string' ? { type: parsed.type } : {}),
      ...(typeof parsed.seq === 'number' ? { seq: parsed.seq } : {}),
      ...(typeof parsed.data?.turn === 'number'
        ? { turn: parsed.data.turn }
        : {}),
    };
  } catch {
    // @ignore-catch 坏行不是清理对象：保留原样，交给既有坏行恢复逻辑
    return null;
  }
}

/** 单轮 thinking 统计（计划与报告共用） */
export interface ThinkingTurnStat {
  /** 轮号（`turn/start` 的 `data.turn`；首轮之前的事件记 0） */
  turn: number;
  events: number;
  bytes: number;
  /** 该轮 thinking 是否在本次计划内被清理 */
  pruned: boolean;
}

/** 清理计划（纯数据，不落盘） */
export interface ThinkingPrunePlan {
  totalEvents: number;
  thinkingEvents: number;
  prunableEvents: number;
  prunableBytes: number;
  /** 会话内最大轮号（0 = 无 `turn/start` ⇒ 不清理） */
  maxTurn: number;
  /** 保留轮次下界（`turn >= keepFromTurn` 的 thinking 全保留；0 = 全部保留） */
  keepFromTurn: number;
  /** 剩余事件数（= `totalEvents - prunableEvents`） */
  remainingEvents: number;
  /** 文件内最大 seq（该行永不清理） */
  maxSeq: number;
  turns: ThinkingTurnStat[];
  /** 待删除行下标（作用于传入的**非空行**数组，升序） */
  pruneIndexes: number[];
}

/**
 * 规划一次「按轮保留」的 thinking 清理（**纯函数**）。
 *
 * @param lines 事件文件切分后的**非空行**（调用方负责过滤空行）
 */
export function planThinkingPrune(
  lines: readonly string[],
  options: { keepTurns?: number } = {}
): ThinkingPrunePlan {
  const keepTurns = Math.max(
    1,
    Math.floor(options.keepTurns ?? DEFAULT_THINKING_KEEP_TURNS)
  );

  const parsed: Array<ParsedEventLine | null> = new Array(lines.length);
  const lineBytes: number[] = new Array(lines.length);
  const turnOfLine: number[] = new Array(lines.length);
  let currentTurn = 0;
  let maxTurn = 0;
  let maxSeq = 0;
  let maxSeqIndex = -1;
  let thinkingEvents = 0;

  for (let i = 0; i < lines.length; i++) {
    const event = parseEventLine(lines[i]);
    parsed[i] = event;
    lineBytes[i] = Buffer.byteLength(lines[i], 'utf-8') + 1;
    if (event?.type === TURN_START_TYPE && typeof event.turn === 'number') {
      currentTurn = event.turn;
      if (event.turn > maxTurn) maxTurn = event.turn;
    }
    turnOfLine[i] = currentTurn;
    if (typeof event?.seq === 'number' && event.seq > maxSeq) {
      maxSeq = event.seq;
      maxSeqIndex = i;
    }
    if (event?.type === THINKING_TYPE) thinkingEvents++;
  }

  // 无 turn/start（v0 legacy / 空会话）⇒ 不猜轮次，整体不动
  const keepFromTurn = maxTurn > keepTurns ? maxTurn - keepTurns + 1 : 0;

  const pruneIndexes: number[] = [];
  let prunableBytes = 0;
  const byTurn = new Map<number, ThinkingTurnStat>();

  const lastIndex = lines.length - 1;
  for (let i = 0; i < lines.length; i++) {
    const event = parsed[i];
    if (event?.type !== THINKING_TYPE) continue;
    const turn = turnOfLine[i];
    const stat = byTurn.get(turn) ?? {
      turn,
      events: 0,
      bytes: 0,
      pruned: false,
    };
    stat.events++;
    stat.bytes += lineBytes[i];
    byTurn.set(turn, stat);

    if (keepFromTurn === 0) continue;
    if (turn >= keepFromTurn) continue;
    // 不变量③/⑤：最大 seq 那一行、以及文件末行永不删
    if (i === maxSeqIndex || i === lastIndex) continue;
    pruneIndexes.push(i);
    prunableBytes += lineBytes[i];
    stat.pruned = true;
  }

  return {
    totalEvents: lines.length,
    thinkingEvents,
    prunableEvents: pruneIndexes.length,
    prunableBytes,
    maxTurn,
    keepFromTurn,
    remainingEvents: lines.length - pruneIndexes.length,
    maxSeq,
    turns: [...byTurn.values()].sort((a, b) => a.turn - b.turn),
    pruneIndexes,
  };
}

/** 单文件处理结果 */
export interface ThinkingPruneFileResult {
  sessionId: string;
  filePath: string;
  /**
   * 处理结论。`recent-write` = `events.jsonl` 近期被写过（可能正在流式落盘）⇒ 本轮不动。
   *
   * 刻意不用 `active` / `idle` 等状态词：本字段是**清理结论**而非会话状态，
   * 状态词汇以 `state/engine/stateMachineCatalog.ts` 为唯一事实源（lint:state-ratchet）。
   */
  status: 'missing' | 'empty' | 'recent-write' | 'noop' | 'ok';
  /** 处理前字节数 */
  bytesBefore: number;
  /** 处理后字节数（`apply=false` 时为预演值） */
  bytesAfter: number;
  /** 是否真的写盘 */
  applied: boolean;
  plan?: ThinkingPrunePlan;
  backupPath?: string;
}

export interface PruneEventThinkingFileParams {
  filePath: string;
  sessionId: string;
  /** 保留最近轮数（默认 10） */
  keepTurns?: number;
  /** 活跃阈值（毫秒）；`mtime` 在窗口内 ⇒ 跳过。0/缺省 ⇒ 不判活跃 */
  idleMs?: number;
  /** 是否写盘（false = 只预演） */
  apply: boolean;
  /** 时间注入（测试用） */
  now?: number;
  /** 备份根目录（传入则写盘前把原文件整份复制到 `<backupDir>/<sessionId>/events.jsonl`） */
  backupDir?: string;
}

/**
 * 对单个 `events.jsonl` 执行（或预演）thinking 清理。
 *
 * 幂等：清理过的文件再次执行 ⇒ `prunableEvents === 0` ⇒ `status: 'noop'`。
 */
export function pruneEventThinkingFile(
  params: PruneEventThinkingFileParams
): ThinkingPruneFileResult {
  const { filePath, sessionId, apply } = params;
  if (!existsSync(filePath)) {
    return {
      sessionId,
      filePath,
      status: 'missing',
      bytesBefore: 0,
      bytesAfter: 0,
      applied: false,
    };
  }

  const st = statSync(filePath);
  const bytesBefore = st.size;
  const now = params.now ?? Date.now();
  if (params.idleMs && now - st.mtimeMs < params.idleMs) {
    return {
      sessionId,
      filePath,
      status: 'recent-write',
      bytesBefore,
      bytesAfter: bytesBefore,
      applied: false,
    };
  }

  const lines = readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return {
      sessionId,
      filePath,
      status: 'empty',
      bytesBefore,
      bytesAfter: bytesBefore,
      applied: false,
    };
  }

  const plan = planThinkingPrune(lines, { keepTurns: params.keepTurns });
  if (plan.prunableEvents === 0) {
    return {
      sessionId,
      filePath,
      status: 'noop',
      bytesBefore,
      bytesAfter: bytesBefore,
      applied: false,
      plan,
    };
  }

  const pruneSet = new Set(plan.pruneIndexes);
  const kept = lines.filter((_, i) => !pruneSet.has(i));
  const bytesAfter = kept.reduce(
    (sum, line) => sum + Buffer.byteLength(line, 'utf-8') + 1,
    0
  );
  if (!apply) {
    return {
      sessionId,
      filePath,
      status: 'ok',
      bytesBefore,
      bytesAfter,
      applied: false,
      plan,
    };
  }

  let backupPath: string | undefined;
  if (params.backupDir) {
    const sessionBackupDir = join(params.backupDir, sessionId);
    mkdirSync(sessionBackupDir, { recursive: true });
    backupPath = join(sessionBackupDir, 'events.jsonl');
    copyFileSync(filePath, backupPath);
  }

  // 原子替换：临时文件 + rename（半截文件永不被读到）
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(
    tmpPath,
    kept.length > 0 ? `${kept.join('\n')}\n` : '',
    'utf-8'
  );
  renameSync(tmpPath, filePath);

  // 不变量⑤：派生物 events.idx 的字节偏移全部失效 ⇒ 删除重建；tail 对齐最大 seq
  const dir = dirname(filePath);
  const idxPath = join(dir, 'events.idx');
  if (existsSync(idxPath)) rmSync(idxPath, { force: true });
  writeFileSync(join(dir, 'events.tail'), String(plan.maxSeq), 'utf-8');

  return {
    sessionId,
    filePath,
    status: 'ok',
    bytesBefore,
    bytesAfter,
    applied: true,
    plan,
    ...(backupPath ? { backupPath } : {}),
  };
}
