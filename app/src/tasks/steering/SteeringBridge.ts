/**
 * SteeringBridge — CG3 模块与中轮 Steering 的桥接层
 *
 * P1-10: 封装 SteeringManager，让 CG3 模块（AlwaysOnRuntime/Cron/用户）
 * 可以在 Agent ReAct 循环中注入外部指令。
 *
 * 两处注入点（对标 openworker TurnEngine._loop）：
 *   A: 模型完成文本回答但无 tool_calls 时
 *   B: 一轮所有 tool_calls 执行完毕后
 *
 * 自身不导入 @modules/core 或 @modules/monitoring。
 */
import { cg3Log } from '../cg3Env';

export interface SteeringCommand {
  text: string;
  source: 'user' | 'alwayson' | 'cron' | 'system';
  /** 目标会话 ID（用于过滤 — 仅注入到匹配的会话） */
  sessionId?: string;
}

export class SteeringBridge {
  /**
   * 排队一条中轮指令（外部可随时调用）
   * @returns false 如果队列已满
   */
  async queue(command: SteeringCommand): Promise<boolean> {
    try {
      const { getGlobalSteeringManager } =
        await import('../../query/SteeringManager');
      const mgr = getGlobalSteeringManager();
      const success = mgr.queueSteering(command.text, command.source);
      if (success) {
        cg3Log('tasks:steering:bridge', 'info', 'queued', {
          source: command.source,
          sessionId: command.sessionId,
        });
      }
      return success;
    } catch (err) {
      cg3Log('tasks:steering:bridge', 'error', 'queueFailed', {
        error: String(err),
      });
      return false;
    }
  }

  /** 是否有待注入的指令 */
  async hasPending(): Promise<boolean> {
    try {
      const { getGlobalSteeringManager } =
        await import('../../query/SteeringManager');
      return getGlobalSteeringManager().hasPending();
    } catch (err) {
      // KB-STEER-BRIDGE-LOG（2026-08-29）：import 失败静默返回 false → TAORLoop
      // 跳过 steering 注入，且无排查线索（与 queueFailed 的 cg3Log 处理一致）
      cg3Log('tasks:steering:bridge', 'error', 'hasPendingFailed', {
        error: String(err),
      });
      return false;
    }
  }

  /** 待处理数量 */
  async pendingCount(): Promise<number> {
    try {
      const { getGlobalSteeringManager } =
        await import('../../query/SteeringManager');
      return getGlobalSteeringManager().pendingCount;
    } catch (err) {
      cg3Log('tasks:steering:bridge', 'error', 'pendingCountFailed', {
        error: String(err),
      });
      return 0;
    }
  }

  /**
   * 消费所有待注入指令，返回格式化的注入消息。
   * 由 Agent Loop（TAORLoop）在两个注入点调用：
   *   A: 模型完成文本回答但无 tool_calls 时
   *   B: 一轮所有 tool_calls 执行完毕后
   */
  async consumeAll(): Promise<
    Array<{ role: 'user'; content: string; source?: string }>
  > {
    try {
      const { getGlobalSteeringManager } =
        await import('../../query/SteeringManager');
      const messages = getGlobalSteeringManager().consumeAll();
      if (messages.length > 0) {
        cg3Log('tasks:steering:bridge', 'info', 'consumed', {
          count: messages.length,
        });
      }
      return messages;
    } catch (err) {
      cg3Log('tasks:steering:bridge', 'error', 'consumeFailed', {
        error: String(err),
      });
      return [];
    }
  }

  /** 清空所有待注入指令（不注入） */
  async clear(): Promise<void> {
    try {
      const { getGlobalSteeringManager } =
        await import('../../query/SteeringManager');
      getGlobalSteeringManager().clear();
    } catch {
      // best-effort
    }
  }
}

/** 全局单例 */
let _steerBridge: SteeringBridge | null = null;

export function getSteeringBridge(): SteeringBridge {
  if (!_steerBridge) _steerBridge = new SteeringBridge();
  return _steerBridge;
}
