/**
 * 工具调用纠偏（2026-11-01 从 `ReActToolLoop` 外移，行为等价）
 *
 * 两条互补的"软纠偏"（都是 `user` 角色 + `system` 片段 ⇒ 比 tool 结果更醒目，模型必然处理）：
 *   ① **同工具同参数**重复调用（P2-3，2026-09-02）：相邻两轮完全一致 ⇒ 要求改用不同参数；
 *   ② **跨轮重读已读文件**（2026-11-01，Bug 4 第三项）：路径在本会话读过 ⇒ 提醒"已读过，
 *      不要重新探路；确需细节用 offset/limit 局部重读"（每路径仅一次）。
 *
 * 外移理由：`ReActToolLoop` 已接近 2000 行上限（R04-001），把纯编排逻辑挪出以便单测。
 */

import {
  createFragment,
  renderFragment,
  FRAGMENT_KIND_FIELD,
} from '@modules/context';
import { getLogger } from '@modules/monitoring';
import {
  buildRereadNotice,
  createReadFileAnchorState,
  markNotified,
  recordReadCalls,
} from '../services/readFileAnchor';

const logger = getLogger('chat:toolCallCorrection');

/** 最小工具调用形状（与 `ToolCallEntry` 结构兼容） */
export interface ToolCallLike {
  name: string;
  input?: Record<string, unknown>;
}

/** 宿主依赖（由 `ReActToolLoop` 注入，模块本身不持有循环状态） */
export interface ToolCallCorrectionDeps {
  /** 「工具名+归一化参数」key（宿主实现，保证与历史口径一致） */
  argsKey(input: Record<string, unknown>): string;
  /** 本轮工具轮次（已读台账的轮次口径） */
  getToolTurn(): number;
  /** 会话 id（日志用） */
  getSessionId(): string;
  /** 追加一条软纠偏消息到下一轮的上下文中 */
  pushReminder(text: string): void;
  /** 本轮已注入软纠偏 ⇒ 基类的无进展熔断让路一次 */
  markCorrectionPending(): void;
}

export class ToolCallCorrection {
  private lastKeys: string[] | null = null;
  private readonly readAnchor = createReadFileAnchorState();

  constructor(private readonly deps: ToolCallCorrectionDeps) {}

  /** 每轮工具调用结束后调用一次 */
  evaluate(calls: readonly ToolCallLike[]): void {
    const currentKeys = calls.map(
      (tc) => `${tc.name}:${this.deps.argsKey(tc.input ?? {})}`
    );
    const prevKeys = this.lastKeys;
    this.lastKeys = currentKeys;

    const isExactRepeat =
      !!prevKeys &&
      currentKeys.length > 0 &&
      currentKeys.length === prevKeys.length &&
      currentKeys.every((k, i) => k === prevKeys[i]);

    if (isExactRepeat) {
      this._injectExactRepeat(calls);
      return;
    }
    // 不是"与上一轮完全一致" ⇒ 仍可能是**跨轮重读同一文件**（参数只差 offset/limit）
    this._injectRereadAnchor(calls);
  }

  /** ① 同工具同参数重复调用 */
  private _injectExactRepeat(calls: readonly ToolCallLike[]): void {
    const names = [...new Set(calls.map((c) => c.name))].join('、');
    this.deps.pushReminder(
      `你刚刚重复调用了与上一轮完全相同的工具（${names}，参数相同）。` +
        `该工具的结果已在上文上下文中，请直接基于已有内容分析并作答，` +
        `不要再调用相同的工具与参数。如确需查看不同部分，请使用不同的参数` +
        `（例如 file_read 的 offset/limit 分页读取不同行段）。`
    );
    logger.warn('reactToolLoop:repeat_call_correction_injected', {
      sessionId: this.deps.getSessionId(),
      toolNames: names,
      toolTurn: this.deps.getToolTurn(),
    });
    this.deps.markCorrectionPending();
    recordReadCalls(this.readAnchor, calls, this.deps.getToolTurn());
  }

  /** ② 跨轮重读已读文件（每路径仅提示一次） */
  private _injectRereadAnchor(calls: readonly ToolCallLike[]): void {
    const turn = this.deps.getToolTurn();
    const notice = buildRereadNotice(this.readAnchor, calls, turn);
    recordReadCalls(this.readAnchor, calls, turn);
    if (!notice) return;

    markNotified(this.readAnchor, calls);
    this.deps.pushReminder(notice);
    logger.warn('reactToolLoop:reread_anchor_injected', {
      sessionId: this.deps.getSessionId(),
      toolTurn: turn,
    });
    this.deps.markCorrectionPending();
  }
}
