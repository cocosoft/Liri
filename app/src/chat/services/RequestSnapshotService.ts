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
 * RequestSnapshotService — 模型输入快照（TR-12-B，2026-09-22）
 *
 * 目的：让"模型当时看到了什么"可从事件日志重建（project_rules §1.6 红线，v7.12.0）。
 * 快照对象 = 本轮请求实际携带的**工具清单** + **系统提示词分段**。
 *
 * 引用式去重（本服务的核心）：
 *   - 实测工具清单 60 个 / 53,361 字符、系统提示词基线 7,449 字符
 *     ⇒ 每轮全量落盘 50 轮 ≈ 3MB，不可接受；
 *   - 故**每轮仍写一条事件**（保证"第 N 轮输入是什么"不断链），但**全量正文只在
 *     内容变化时落**，未变化的单元只写 `refSeq`/`toolsRefSeq` 指向**含全量**的更早事件。
 *
 * 索引不变量：`_index` 只登记"**含全量正文**"的那条事件 seq
 *   ⇒ 读端 `refSeq` **一跳**即可取到全量，无需链式回溯。
 *
 * 索引可重建：进程重启后首次 `record` 会按类型白名单回读该会话历史事件重建
 *   ⇒ 不引入新持久化（R01），事件日志自身即索引源。
 *
 * 失败语义：落盘失败仅 warn，不阻断消息主路径（CS03，对齐 `_appendEventsForMessage`）。
 *
 * 详见 `.trae/specs/model-input-snapshot-events.md`。
 */

import type { EventLogStorage } from '@modules/session';
import type { LiriEvent } from '../types/events';
import type { LiriEventMap } from '../types/eventPayloads';
import { hashContent } from '@modules/security';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('chat:request-snapshot');

type ModelInputPayload = LiriEventMap['context/model-input'];

/** 系统提示词单段输入（粒度 = 既有 `SystemPromptSection.name`） */
export interface SnapshotSectionInput {
  name: string;
  /** 段正文；`null` = 本轮该段为空 ⇒ 不参与快照（空即空，不占位） */
  content: string | null;
}

/** 一轮请求的模型可见输入 */
export interface ModelInputSnapshot {
  /** 工具清单全量（`ToolRegistry.getToolSchemas()` 产物） */
  tools?: unknown[];
  /** 系统提示词分段（stable + dynamic） */
  sections?: SnapshotSectionInput[];
  /** 组装模式（`PromptMode`） */
  mode?: string;
  /** 既有 `SystemPromptReport` 的聚合值（复用，不重算） */
  tokens?: { stable: number; dynamic: number };
}

/** 单元索引条目：记录**含全量正文**的最近一次事件 */
interface UnitIndexEntry {
  hash: string;
  seq: number;
}

/** 工具清单作为一个整体单元（不逐工具分段，Spec D4） */
const TOOLS_KEY = 'tools';
const sectionKey = (name: string): string => `section:${name}`;

/** 索引重建的单次扫描上限（只读该类型事件，实际数量极少） */
const MAX_INDEX_SCAN = 10000;

export class RequestSnapshotService {
  /** sessionId → (单元键 → 含全量的 hash/seq) */
  private readonly _index = new Map<string, Map<string, UnitIndexEntry>>();

  constructor(
    /** 复用 ChatManager 的 per-session 事件日志实例（禁止自建，避免 tailSeq 分裂） */
    private readonly _getEventLog: (sessionId: string) => EventLogStorage
  ) {}

  /**
   * 记录一轮模型输入快照。
   *
   * 调用方应在**发请求前 await**（§1.6「写前持久化」：模型可见输入先落盘再请求）。
   */
  async record(sessionId: string, input: ModelInputSnapshot): Promise<void> {
    const tools =
      Array.isArray(input.tools) && input.tools.length > 0
        ? input.tools
        : undefined;
    const sections = (input.sections ?? []).filter(
      (s): s is SnapshotSectionInput & { content: string } =>
        typeof s.content === 'string' && s.content.length > 0
    );
    if (!tools && sections.length === 0) {
      // 无模型可见输入 ⇒ 不产事件（CS04：空即空，不写假快照）
      return;
    }

    const index = await this._ensureIndex(sessionId);
    const payload: ModelInputPayload = {};
    if (input.mode) payload.mode = input.mode;
    if (input.tokens) payload.tokens = input.tokens;

    if (tools) {
      const hash = hashContent(JSON.stringify(tools));
      const prev = index.get(TOOLS_KEY);
      payload.tools = { hash, count: tools.length };
      if (prev && prev.hash === hash) {
        payload.toolsRefSeq = prev.seq;
      } else {
        payload.tools.schemas = tools;
      }
    }

    if (sections.length > 0) {
      payload.sections = sections.map((s) => {
        const hash = hashContent(s.content);
        const prev = index.get(sectionKey(s.name));
        return prev && prev.hash === hash
          ? { name: s.name, hash, refSeq: prev.seq }
          : { name: s.name, hash, content: s.content };
      });
    }

    const event: LiriEvent = {
      type: 'context/model-input',
      seq: 0, // 由 append 在 mutex 内原子分配
      time: Date.now(),
      sessionId,
      data: payload,
    };

    try {
      const log = this._getEventLog(sessionId);
      const result = await log.append(event);
      if (!result.ok && result.reason !== 'duplicate-seq') {
        logger.warn('模型输入快照事件追加失败', {
          sessionId,
          reason: result.reason,
        });
        return;
      }
      // 只把"含全量正文"的单元登记进索引 —— 保证 refSeq 一跳到全量
      // 注：`append` **不写回** 传入的 `event.seq`（传 0 = 由 mutex 内自动分配）
      // ⇒ 必须取返回值：`correctedSeq`（seq 冲突纠正后）优先，否则 `tailSeq`（本次分配值）。
      const seq = result.correctedSeq ?? result.tailSeq;
      if (payload.tools?.schemas) {
        index.set(TOOLS_KEY, { hash: payload.tools.hash, seq });
      }
      for (const s of payload.sections ?? []) {
        if (typeof s.content === 'string') {
          index.set(sectionKey(s.name), { hash: s.hash, seq });
        }
      }
    } catch (e) {
      // @ignore-catch — 快照落盘失败不阻断消息主路径（CS03），已 warn
      logger.warn('模型输入快照写入异常', {
        sessionId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** 会话删除时清理索引（内存，不做持久化） */
  dispose(sessionId: string): void {
    this._index.delete(sessionId);
  }

  /** 取（或按历史事件重建）会话索引 */
  private async _ensureIndex(
    sessionId: string
  ): Promise<Map<string, UnitIndexEntry>> {
    const cached = this._index.get(sessionId);
    if (cached) return cached;

    const map = new Map<string, UnitIndexEntry>();
    this._index.set(sessionId, map);
    try {
      const log = this._getEventLog(sessionId);
      if (!log.exists()) return map;
      const events = await log.read({
        types: ['context/model-input'],
        limit: MAX_INDEX_SCAN,
      });
      for (const ev of events) {
        const data = ev.data as ModelInputPayload;
        if (data.tools?.schemas) {
          map.set(TOOLS_KEY, { hash: data.tools.hash, seq: ev.seq });
        }
        for (const s of data.sections ?? []) {
          if (typeof s.content === 'string') {
            map.set(sectionKey(s.name), { hash: s.hash, seq: ev.seq });
          }
        }
      }
    } catch (e) {
      // @ignore-catch — 重建失败退化为"重新落一次全量"（不影响正确性，仅多占体积）
      logger.warn('模型输入快照索引重建失败（退化为重新落全量）', {
        sessionId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return map;
  }
}
