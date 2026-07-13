/**
 * @owner chat/ChatManager
 *
 * 工具调用收敛检测器
 * 检测同一 session 中是否重复调用同一个工具且用户持续不满意（追问模式），
 * 触发后注入"暂停重复操作，先排查问题"的提示。
 *
 * 应用场景：
 * - image_generate + image_display 连续 3 次用户仍说"看不到" → 熔断
 * - 任何工具连续 3 次成功但用户追问 → 提示 AI 停止重复并排查
 */
import { Logger } from '@modules/monitoring';

const logger = new Logger({ module: 'chat:convergenceDetector' });

interface ToolCallRecord {
  toolName: string;
  timestamp: number;
  success: boolean;
  /** 近似参数指纹（避免存完整参数导致内存膨胀） */
  argsFingerprint: string;
}

interface SessionConvergenceState {
  calls: ToolCallRecord[];
  /** 最后追问轮次 */
  lastComplaintRound: number;
  /** 当前会话中是否已触发熔断 */
  melted: boolean;
}

export class ConvergenceDetector {
  private sessions: Map<string, SessionConvergenceState> = new Map();
  private maxRecords = 20;

  /**
   * 记录一次工具调用
   */
  recordToolCall(
    sessionId: string,
    toolName: string,
    success: boolean,
    argsPreview?: Record<string, unknown>
  ): void {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = { calls: [], lastComplaintRound: -1, melted: false };
      this.sessions.set(sessionId, state);
    }

    state.calls.push({
      toolName,
      timestamp: Date.now(),
      success,
      argsFingerprint: this.fingerprint(argsPreview),
    });

    if (state.calls.length > this.maxRecords) {
      state.calls.shift();
    }
  }

  /**
   * 标记一轮用户追问（"还是不行"等）
   */
  markComplaint(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state) {
      state.lastComplaintRound = state.calls.length;
    }
  }

  /**
   * 检查是否需要熔断 — 同一工具连续成功 ≥3 次且用户仍在追问
   * @returns 是否需要触发熔断 + 熔断提示词
   */
  checkMeltdown(sessionId: string): { shouldMelt: boolean; reason: string } {
    const state = this.sessions.get(sessionId);
    if (!state || state.melted || state.calls.length < 3) {
      return { shouldMelt: false, reason: '' };
    }

    // 只检查最近 5 条
    const recent = state.calls.slice(-5);
    if (recent.length < 3) return { shouldMelt: false, reason: '' };

    // 找到最近出现 ≥3 次的工具名
    const toolCounts = new Map<string, ToolCallRecord[]>();
    for (const r of recent) {
      if (!toolCounts.has(r.toolName)) {
        toolCounts.set(r.toolName, []);
      }
      toolCounts.get(r.toolName)!.push(r);
    }

    let maxToolName = '';
    let maxCount = 0;
    for (const [name, recs] of toolCounts) {
      if (recs.length > maxCount) {
        maxCount = recs.length;
        maxToolName = name;
      }
    }

    if (maxCount >= 3) {
      // 检查这些调用是否是同一个参数指纹（说明在重复完全相同的操作）
      const recs = toolCounts.get(maxToolName)!;
      const fp = recs[0].argsFingerprint;
      const sameArgs = recs.every((r) => r.argsFingerprint === fp);

      if (sameArgs || state.lastComplaintRound >= state.calls.length - 3) {
        state.melted = true;
        const reason = sameArgs
          ? `检测到 ${maxToolName} 连续 ${maxCount} 次以相同参数被调用且用户不满意，建议停止重复操作，排查根本原因。`
          : `检测到 ${maxToolName} 连续 ${maxCount} 次被调用且用户持续追问，建议停止当前操作方向，重新分析问题。`;
        logger.warn('[ConvergenceDetector] MELTDOWN triggered', {
          sessionId,
          toolName: maxToolName,
          callCount: maxCount,
        });
        return { shouldMelt: true, reason };
      }
    }

    return { shouldMelt: false, reason: '' };
  }

  /** 重置会话状态 */
  resetSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private fingerprint(args?: Record<string, unknown>): string {
    if (!args) return 'no-args';
    // 只用参数的前几个 key 做指纹
    const keys = Object.keys(args).sort().slice(0, 3).join(',');
    return keys || 'no-args';
  }
}

/** 模块级单例 */
export const convergenceDetector = new ConvergenceDetector();
