/**
 * SidecarJobRegistry —— 侧车**异步作业**登记表（T1-2② / TG-2+TG-6 · **B₂ 片**，2026-10-13）。
 *
 * 定位：「长耗时侧车工具**不得同步阻塞**」—— 工具调 `submitJob()` 提交作业后**立即返回**
 * （拿 `Promise` 等完成），内核据此可投影 `SUSPENDED`；侧车完成时经
 * `notify{event:'job.completed'}` 回推，由主管帧分派**投递到本表**结算。
 *
 * ## 纪律
 * - **不臆造**：未知 `jobId` 的完成通知（重复投递 / 超时后才到 / 非本表作业）⇒ **只留痕、不新增条目**、
 *   不伪造成功；无法判定成败的通知由 `parseJobCompleted()` 直接返回 `null` ⇒ **不消费该帧**。
 * - **不留悬挂**：每条作业都有**超时兜底**；提交失败 / 侧车崩溃 由 `fail()` / `rejectAll()` **显式结算**。
 * - **成败同报**：`ok=false` 亦为一次结算（`reject`），绝不"静默悬挂"。
 *
 * 协议（常量、载荷、解析）在唯一基座 `utils/sidecarIpc.ts`，本模块**只做登记与派发**（CS01）。
 */

import { getLogger } from '@modules/monitoring';
import { parseJobCompleted } from '../../utils/sidecarIpc.js';

const logger = getLogger('tools:sidecar.jobs');

/** 单条在飞作业的内部记录 */
interface JobRecord {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  action: string;
}

export class SidecarJobRegistry {
  private readonly jobs = new Map<string, JobRecord>();

  /** 在飞作业数（观测用） */
  get size(): number {
    return this.jobs.size;
  }

  /**
   * 登记一条作业并返回其完成 Promise（**超时兜底** ⇒ 到时 reject，绝不永久悬挂）。
   *
   * 同 `jobId` 重复登记 ⇒ 先结算旧的（**不静默覆盖**），避免旧 Promise 悬挂。
   */
  register(jobId: string, timeoutMs: number, action: string): Promise<unknown> {
    if (this.jobs.has(jobId)) {
      this.fail(jobId, new Error(`侧车作业 id 重复登记：${jobId}`));
    }
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.jobs.delete(jobId);
        logger.warn('侧车作业超时（兜底结算为失败）', { jobId, action });
        reject(new Error(`侧车作业超时：${action}`));
      }, timeoutMs);
      this.jobs.set(jobId, { resolve, reject, timer, action });
    });
  }

  /** 提交失败 / 取消等**本地**原因 ⇒ 显式结算（清理计时器，避免残留） */
  fail(jobId: string, reason: Error): void {
    const rec = this.jobs.get(jobId);
    if (!rec) return;
    this.jobs.delete(jobId);
    clearTimeout(rec.timer);
    rec.reject(reason);
  }

  /**
   * 由主管帧分派调用：尝试把该帧当作**作业完成通知**消费。
   *
   * @returns `true` = 该帧**属作业协议**（已消费，分派方不必再按 `id` 处理）；
   *          `false` = 非作业通知（`object` 不匹配 / 事件名不符 / 载荷非法）⇒ 交回原分派。
   */
  completeFromFrame(frame: Record<string, unknown>): boolean {
    const payload = parseJobCompleted(frame);
    if (!payload) return false;
    const rec = this.jobs.get(payload.jobId);
    if (!rec) {
      // **不臆造**：未知作业（重复通知 / 超时后到达 / 非本表）⇒ 只留痕，不新增条目、不伪造成功
      logger.debug('侧车作业完成通知未命中登记（忽略）', {
        jobId: payload.jobId,
      });
      return true;
    }
    this.jobs.delete(payload.jobId);
    clearTimeout(rec.timer);
    if (payload.ok) {
      rec.resolve(payload.result);
    } else {
      rec.reject(new Error(payload.error ?? `侧车作业失败：${rec.action}`));
    }
    return true;
  }

  /** 侧车崩溃 / 停止 ⇒ 全部在飞作业 reject（主内核收普通错误，不悬挂） */
  rejectAll(reason: Error): void {
    for (const jobId of [...this.jobs.keys()]) {
      this.fail(jobId, reason);
    }
  }
}
