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
 * 事件日志崩溃修复链（原 `EventLogStorage` 的 repair 簇）
 *
 * 由 `EventLogStorage.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §37）：
 *   D4-1 torn-tail 检测 → D4-2 截断修复 → D4-3 未闭合轮次合成 closers →
 *   D4-4 首次读取前自动修复（内存标记防重复 + 防递归）。
 *
 * ⚠️ **只搬不改**：逻辑逐字保留；logger module 名保持 `session:event-log`
 * （与宿主一致）⇒ 日志输出不变。
 */

import { promises as fs } from 'fs';
import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring/logs/Logger.js';
import type { LiriEvent } from '@modules/session/types/events';
import { splitJsonLine } from './eventLineParse';

const logger = getLogger('session:event-log');

/**
 * 修复告警节流窗口（2026-09-23）：撕裂/closers/首读修复三类告警共用。
 *
 * 同一份损坏被反复读取（每次 read 都触发 ensureRepairChecked）时防刷屏。
 */
const REPAIR_ALERT_COOLDOWN_MS = 60_000;

/**
 * 宿主注入面（**显式端口**）。
 *
 * 这些是 repair 无法自持的宿主事实：文件路径与存在性、tail 状态（seq/turn 的重置与重算）、
 * 逐个读盘行接口、快照缓存失效、以及故障恢复收尾所需的 `append`。
 */
export interface EventLogRepairDeps {
  readonly sessionId: string;
  readonly filePath: string;
  exists(): boolean;
  /** 重置 tail 状态（宿主：`tailSeq = 0` / `tailSeqInitialized = false` / `maxTurn = null`） */
  resetTailState(): void;
  getTailSeq(force?: boolean): Promise<number>;
  writePersistedTailSeq(seq: number): Promise<void>;
  /** 逐行读接口（宿主 `createReadlineInterface(file?)` 的结构子集） */
  createReadlineInterface(file?: string): AsyncIterable<string>;
  /** 文件被截断/变更后失效快照缓存 */
  clearSnapshotCache(): void;
  append(event: LiriEvent): Promise<{ ok: boolean }>;
}

/** 事件日志崩溃修复链（宿主 `EventLogStorage` 持有单实例） */
export class EventLogRepair {
  /** D4-4：首次读取前自动修复只做一次（内存标记，防重复 + 防递归） */
  private _repairChecked = false;
  /** 修复告警最近一次输出时间（独立节流窗，与 append 失败告警互不干扰） */
  private lastRepairAlertAt = 0;

  constructor(private readonly deps: EventLogRepairDeps) {}

  /**
   * D4-1：检测 events.jsonl 末尾是否存在半写行（torn tail）
   *
   * 应用崩溃时 fs.appendFile 可能中断，末尾残留半写 JSON 行。判定规则：
   *   1. 文件末尾无换行符（\n 结尾）→ 最后一条记录可能不完整
   *   2. 或最后一条记录 JSON.parse 失败 → 半写
   * 双重判定（对齐 deepseek-harness finish()："ignoring a final record without
   * a newline as a torn tail"），避免误判正常文件。
   *
   * @returns { offset: number, torn: boolean }——offset 为安全截断位置（= 最后一个
   *   完整记录末尾字节数，含换行），torn=true 表示存在需要截断的半写行
   */
  async scanForTornTail(): Promise<{ offset: number; torn: boolean }> {
    if (!this.deps.exists()) return { offset: 0, torn: false };
    try {
      const stat = await fs.stat(this.deps.filePath);
      if (stat.size === 0) return { offset: 0, torn: false };

      // 读末尾 64KB（足够覆盖典型半写；超大单行理论上可能超限，但事件行通常 < 10KB）
      const tailSize = Math.min(64 * 1024, stat.size);
      const buf = Buffer.alloc(tailSize);
      const fd = await fs.open(this.deps.filePath, 'r');
      try {
        await fd.read(buf, 0, tailSize, stat.size - tailSize);
      } finally {
        await fd.close();
      }

      const text = buf.toString('utf-8');
      // 逐行解析，最后一条完整行的结束字节偏移
      let lastCompleteEnd = 0;
      let lineStart = 0;
      let sawTorn = false;

      // KB-TORN-CUT（2026-09-02 根因修复，P3-8 测试暴露）：读的是"文件末尾 64KB
      // 块"（stat.size-64KB 起），块起点可能切在多字节 UTF-8 字符**中间** → 块首
      // "行"是上一行内容的尾部残片，JSON.parse 必失败——若参与 torn 判定会把正常
      // 文件误报 torn，导致 commitTornRepair 截断删除末尾完整事件（实测中文长文件
      // 600 行被误删 29 行，newTailSeq 回退到 571）。块起点非文件开头时，跳过
      // 首残缺行（推进到第一个 \n 之后）再开始判定。
      if (stat.size > tailSize) {
        const firstNl = text.indexOf('\n');
        if (firstNl >= 0) {
          lineStart = firstNl + 1;
        }
      }

      for (let i = lineStart; i < text.length; i++) {
        if (text[i] === '\n') {
          const line = text.slice(lineStart, i);
          const trimmed = line.trim();
          if (trimmed.length > 0) {
            try {
              JSON.parse(trimmed);
              lastCompleteEnd = i + 1; // 完整行（含换行）
            } catch {
              // 中间损坏行（非末尾）——保守视为 torn（可能是崩溃点）
              sawTorn = true;
            }
          }
          lineStart = i + 1;
        }
      }

      // 剩余无换行的尾行：若 trim 非空且 JSON 不可解析 → torn
      const lastLine = text.slice(lineStart);
      const lastTrimmed = lastLine.trim();
      if (lastTrimmed.length > 0) {
        try {
          JSON.parse(lastTrimmed);
          // KB-TORN-PRESERVE（2026-08-29）：可解析尾行 = JSON 内容完整（半写内容
          // 不可能 parse 成功），无换行仅缺 '\n' 终止符，非数据损坏。原实现把
          // "可解析但无换行"判为 torn 并截断（lastCompleteEnd 停在倒数第二行），
          // 丢弃了完整事件（外部工具/异常落盘的假阳性）。改为整条保留。
          lastCompleteEnd = text.length;
        } catch {
          // 尾行不可解析 → 明确的半写 torn
          sawTorn = true;
        }
      }

      // 全局偏移：读的是末尾 64KB，需加上文件头偏移
      const baseOffset = stat.size - tailSize;
      return {
        offset: baseOffset + lastCompleteEnd,
        torn: sawTorn,
      };
    } catch (e) {
      await handleError(e, {
        module: 'session:event-log',
        action: 'scanForTornTail',
        context: { sessionId: this.deps.sessionId },
      }).catch(() => {});
      return { offset: 0, torn: false };
    }
  }

  /**
   * D4-2：截断 torn tail 至最后一个完整记录，并同步 tailSeq/持久化值
   *
   * 调用方（D4-4 启动钩子 / 首次 read）先 scanForTornTail 确认 torn=true 后再调本方法。
   * 截断失败不抛错（CS03）：返回 false 由调用方决定是否继续降级。
   *
   * @returns 截断后是否成功（false = 无 torn 或截断失败）
   */
  async commitTornRepair(): Promise<boolean> {
    const { offset, torn } = await this.scanForTornTail();
    if (!torn) return false;
    try {
      await fs.truncate(this.deps.filePath, offset);
      // 重置 tailSeq：截断后重新扫描真实最大 seq
      this.deps.resetTailState();
      // P1-2：文件被截断，快照失效
      this.deps.clearSnapshotCache();
      const realTail = await this.deps.getTailSeq(true);
      // 2026-09-23：修复告警加独立节流（冷却窗内降级 debug）
      this.emitRepairAlert('event-log: torn tail 已截断修复', {
        sessionId: this.deps.sessionId,
        truncatedOffset: offset,
        newTailSeq: realTail,
      });
      await this.deps.writePersistedTailSeq(realTail);
      return true;
    } catch (e) {
      await handleError(e, {
        module: 'session:event-log',
        action: 'commitTornRepair',
        context: { sessionId: this.deps.sessionId, offset },
      }).catch(() => {});
      return false;
    }
  }

  /**
   * D4-3：检测未闭合轮次并生成合成 turn/end（interruptedTurnClosers）
   *
   * 应用崩溃可能留下 turn/start 无配对 turn/end 的残缺轮次。扫描事件日志，
   * 对每个"已 start 未 end"的 turn 合成 `turn/end { finishReason: 'canceled' }`
   * （对齐 B 方案"未完成=已中断"语义，前端已有 canceled 终态处理）。
   *
   * 对齐 deepseek-harness `interruptedTurnClosers`：崩溃恢复仅合成缺失的 closers，
   * 不修改已存在事件。
   *
   * @returns 合成的 turn/end 事件数组（seq 从当前 tailSeq+1 连续分配，未落盘）
   *   与需要合成的未闭合 turn 号列表
   */
  async interruptedTurnClosers(): Promise<{
    closers: LiriEvent[];
    openTurns: number[];
  }> {
    // 直接流式扫描文件（不调 read()）——read() 会触发 ensureRepairChecked（D4-4），
    // 首次调用即抢先合成 closers 落盘，导致本方法二次扫描时 turn 已闭合返回空。
    // 本方法作为"原始状态查询"应只看文件真实内容（repair 闭环由 ensureRepairChecked 驱动）。
    const openTurns = new Set<number>();
    if (this.deps.exists()) {
      try {
        const rl = this.deps.createReadlineInterface();
        for await (const line of rl) {
          if (!line.trim()) continue;
          // 2026-08-24 根因修复：损坏行（半写/拼接）用 splitJsonLine 恢复——
          // 裸 JSON.parse 会跳过拼接行，行内真实的 turn/end 丢失 → turn 误判
          // 未闭合 → 每次启动都重复合成 canceled closers（前端全部回复显示中断）。
          for (const obj of splitJsonLine(line)) {
            const event = obj as LiriEvent;
            if (event.type === 'turn/start') {
              openTurns.add((event.data as { turn: number }).turn);
            } else if (event.type === 'turn/end') {
              openTurns.delete((event.data as { turn: number }).turn);
            }
          }
        }
      } catch (e) {
        await handleError(e, {
          module: 'session:event-log',
          action: 'interruptedTurnClosers',
          context: { sessionId: this.deps.sessionId },
        }).catch(() => {});
      }
    }
    const sorted = [...openTurns].sort((a, b) => a - b);
    const tailSeq = await this.deps.getTailSeq();
    const time = Date.now();
    const closers: LiriEvent[] = sorted.map((turn, i) => ({
      type: 'turn/end',
      seq: tailSeq + i + 1,
      time,
      sessionId: this.deps.sessionId,
      data: { turn, finishReason: 'canceled' as const },
    }));
    return { closers, openTurns: sorted };
  }

  /**
   * D4-3：将合成的 turn/end closers 落盘（崩溃恢复收尾）
   *
   * 调用方先 interruptedTurnClosers() 获取 closers，确认非空后调本方法。
   * 逐条 append（append 内含 sanitize + 版本校验 + seq 单调守卫）。
   *
   * @returns 成功写入的 closers 数量（0 = 无未闭合轮次或写入失败）
   */
  async commitInterruptedRepair(): Promise<number> {
    const { closers } = await this.interruptedTurnClosers();
    if (closers.length === 0) return 0;
    let written = 0;
    for (const closer of closers) {
      const result = await this.deps.append(closer);
      if (result.ok) written++;
    }
    if (written > 0) {
      // 2026-09-23：修复告警加独立节流（与撕裂告警共用窗口，冷却窗内降级 debug）
      this.emitRepairAlert('event-log: 崩溃恢复合成 turn/end closers', {
        sessionId: this.deps.sessionId,
        openTurns: closers.map((c) => (c.data as { turn: number }).turn),
        written,
      });
    }
    return written;
  }

  /**
   * D4-4：首次读取前自动崩溃修复（内存标记防重复 + 防递归）
   *
   * 修复链（对齐 deepseek-harness load-time repair）：
   *   1. torn-tail 截断（半写行清理）——见 commitTornRepair
   *   2. 未闭合轮次合成 turn/end closers——见 commitInterruptedRepair
   *
   * 防递归：commitInterruptedRepair → interruptedTurnClosers → read()
   * 会再次进入本方法，靠 `_repairChecked` 在真正执行前已置 true 短路。
   * 失败不抛错（CS03）：修复失败仅告警，读取照常降级（损坏行跳过）。
   */
  async ensureRepairChecked(): Promise<void> {
    if (this._repairChecked) return;
    // 先置标记再执行——防递归（修复内部 read() 再次进入）
    this._repairChecked = true;
    try {
      const tornRepaired = await this.commitTornRepair();
      const closersWritten = await this.commitInterruptedRepair();
      if (tornRepaired || closersWritten > 0) {
        // 2026-09-23：修复告警加独立节流（本处原级别为 info；冷却窗内降级 debug）
        this.emitRepairAlert(
          'event-log: 首次读取触发崩溃修复',
          {
            sessionId: this.deps.sessionId,
            tornRepaired,
            closersWritten,
          },
          'info'
        );
      }
    } catch (e) {
      await handleError(e, {
        module: 'session:event-log',
        action: 'ensureRepairChecked',
        context: { sessionId: this.deps.sessionId },
      }).catch(() => {});
    }
  }

  /**
   * 修复告警（2026-09-23）：`REPAIR_ALERT_COOLDOWN_MS` 窗内降级 debug，防同一份损坏刷屏。
   *
   * 与 append 失败告警（lastAlertAt / circuitOpenUntil）**独立**，互不干扰。
   *
   * @param level 窗外输出级别（撕裂/closers 用 warn；首次读取修复汇总是 info）
   */
  private emitRepairAlert(
    message: string,
    context: Record<string, unknown>,
    level: 'warn' | 'info' = 'warn'
  ): void {
    const now = Date.now();
    if (now - this.lastRepairAlertAt < REPAIR_ALERT_COOLDOWN_MS) {
      logger.debug(`${message}（冷却窗内降级）`, {
        ...context,
        cooldownMs: REPAIR_ALERT_COOLDOWN_MS,
      });
      return;
    }
    this.lastRepairAlertAt = now;
    if (level === 'info') {
      logger.info(message, context);
    } else {
      logger.warn(message, context);
    }
  }
}
