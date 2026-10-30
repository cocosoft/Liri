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
 * B2（2026-10-30，一致性核查 §9.4）：**按轮摘要的服务端供给**。
 *
 * 为什么需要：左侧「轮次导航」/右侧「消息摘要」此前只能对**已加载的一页消息**算摘要
 * ——尾部分页下 26 轮会话只显示最近 9 轮，更早轮次没有任何文本可显示（实测遗留）。
 * 本模块由一次请求返回整会话每轮摘要，供前端补齐未加载轮次。
 *
 * 口径（与 `client/src/utils/roundSummaries.ts` **同一契约**，由常量与测试两端锁定）：
 * - 一条 `user` 消息开启一轮，轮号 = **绝对轮号**（1-based，相对整会话历史）；
 * - 摘要 = 换行归一为空格 + `trim` + 截断至 {@link ROUND_SUMMARY_MAX_CHARS}（超长补 `…`）；
 * - 助手文本优先取 `blocks` 里的 `text` 块，其次取 `content`；
 *   工具循环中的"无正文助手消息"**不覆盖**该轮已有摘要；
 * - 服务端**不产出**展示文案（"暂无内容"等兜底由前端按 i18n 决定）。
 */

/** 单条摘要最大字符数（**跨包契约常量**：与前端 `ROUND_SUMMARY_MAX_CHARS` 逐字同值，
 * 门禁登记见 `scripts/lint-consts.ts` 的 CROSS_PACKAGE_CONTRACT_CONSTS，
 * 守卫见 `app/tests/constants/sameNameConstsB2.test.ts` B5-2-69） */
export const ROUND_SUMMARY_MAX_CHARS = 60;

/** 单次默认返回的轮数（最近 N 轮；更早轮次由 `hasMore` 标示） */
export const ROUND_SUMMARY_DEFAULT_ROUNDS = 100;

/** 单次返回轮数上限（防超大响应） */
export const ROUND_SUMMARY_MAX_ROUNDS_PER_REQUEST = 500;

/** 参与摘要的消息最小形状（`getSessionMessages` 的派生结果即可满足） */
export interface RoundSummarySourceMessage {
  id: string;
  role: string;
  content: string;
  timestamp: number;
  blocks?: Array<Record<string, unknown>>;
}

/** 一轮的摘要（`roundIndex` 为**绝对轮号**） */
export interface SessionRoundSummary {
  roundIndex: number;
  /** 该轮用户消息 id（前端点击跳转用；未加载轮次也带，便于后续定位） */
  userMsgId: string;
  userMsg: string;
  assistantMsg: string;
  timestamp: number;
}

/** `getSessionRoundSummaries` 的返回体（HTTP 直出，不含包装） */
export interface SessionRoundSummariesResult {
  /** 保留的轮次（`roundIndex` 仍为绝对轮号） */
  rounds: SessionRoundSummary[];
  /** 会话真实总轮数（可能大于 `rounds.length`） */
  totalRounds: number;
  /** 是否还有更早轮次被裁剪（`totalRounds > rounds.length`） */
  hasMore: boolean;
}

/** 文本归一：换行转空格 + 截断（超长补省略号）；空文本返回空串 */
export function summarizeRoundText(
  text: string | undefined,
  maxChars: number = ROUND_SUMMARY_MAX_CHARS
): string {
  const normalized = (text ?? '').replace(/\s*\n\s*/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars)}…`
    : normalized;
}

/** 助手消息的"正文"文本：`blocks` 的 text 块优先，否则 `content` */
function assistantText(msg: RoundSummarySourceMessage): string {
  const fromBlocks = (msg.blocks ?? [])
    .filter((b) => b && b.type === 'text' && typeof b.content === 'string')
    .map((b) => b.content as string)
    .join(' ');
  return fromBlocks.trim() || msg.content || '';
}

/**
 * 把消息流按轮切分并生成摘要。
 *
 * @param messages 已按权威顺序排好的会话消息（全量）
 * @param options.maxRounds 只保留**最近** N 轮（缺省 {@link ROUND_SUMMARY_DEFAULT_ROUNDS}；
 *   `<=0` 视为不限），被裁掉的更早轮次不返回，但 `totalRounds` 仍是真实总数
 * @param options.maxChars 单条摘要上限（缺省 {@link ROUND_SUMMARY_MAX_CHARS}）
 * @returns `rounds`（保留的轮次，轮号仍为绝对轮号）+ `totalRounds`（真实总轮数）
 */
export function buildSessionRoundSummaries(
  messages: readonly RoundSummarySourceMessage[],
  options: { maxRounds?: number; maxChars?: number } = {}
): { rounds: SessionRoundSummary[]; totalRounds: number } {
  const maxChars = options.maxChars ?? ROUND_SUMMARY_MAX_CHARS;
  const rounds: SessionRoundSummary[] = [];
  let current: SessionRoundSummary | null = null;

  for (const msg of messages) {
    const role = String(msg.role ?? '').toLowerCase();
    const content = typeof msg.content === 'string' ? msg.content : '';
    if (role === 'user') {
      if (current) rounds.push(current);
      current = {
        roundIndex: rounds.length + 1,
        userMsgId: msg.id,
        userMsg: summarizeRoundText(content, maxChars),
        assistantMsg: '',
        timestamp: msg.timestamp,
      };
    } else if (role === 'assistant' && current) {
      const text = summarizeRoundText(assistantText(msg), maxChars);
      if (text) current.assistantMsg = text;
    }
  }
  if (current) rounds.push(current);

  const totalRounds = rounds.length;
  const maxRounds = options.maxRounds ?? ROUND_SUMMARY_DEFAULT_ROUNDS;
  const kept =
    maxRounds > 0 && totalRounds > maxRounds
      ? rounds.slice(totalRounds - maxRounds)
      : rounds;
  return { rounds: kept, totalRounds };
}
