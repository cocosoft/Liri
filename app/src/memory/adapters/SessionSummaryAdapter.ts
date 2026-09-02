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
 * 跨会话记忆适配器（D 阶段，2026-09-02，接入文档 v5）
 *
 * 把"会话阶段摘要（session/summary 事件）"上卷到跨会话长期记忆库（MemoryManagerImpl，
 * memory_search 语义召回同一事实源），使未来任意会话可经语义召回历史阶段结论。
 *
 * 关键语义（v5 修订，均与接入文档一致）：
 *  - 幂等：createMemory 无按 name 查重 → 本 adapter 自实现查重-upsert（同幂等键命中
 *    updateMemory 覆盖，未命中 createMemory）
 *  - consolidator：高相似批次写入与"相似即删（阈值 0.75）"冲突 → createMemory 传
 *    skipConsolidation（v5 B 案），跨键相似不互删
 *  - 注册时序：createMemory 不校验 type，校验在 scanner/召回/统计路径 → 注册必须在
 *    任何扫描前（ChatManagerImpl 模块加载期调用 registerSessionSummaryMemoryType）
 *  - 实例一致性：默认复用进程内单例 MemoryManagerImpl（同一磁盘 store 目录 + 同一
 *    实例内存 retriever 索引），避免多实例冷索引分叉
 *  - metadata.sessionId 映射 → 落 sessions/{sessionId}/（MemoryStore 分目录）
 *  - 内容约束：禁止携带被折叠事件原文片段（召回不按 type 隔离，相似即删风险）
 *  - 重建为全量对齐式（C−E 删 / E−C 写 / 交集覆盖），只增不删会越重建越膨胀
 */
import { createHash } from 'node:crypto';
import { getLogger } from '@modules/monitoring';
import type { Memory } from '../types/Memory';
import type { MemoryMetadata } from '../types/MemoryMetadata';
import {
  registerMemoryType,
  isValidMemoryType,
  type MemoryTypeSemantics,
} from '../types/MemoryType';
// 注意：MemoryManagerImpl 用 type-only import + lazy dynamic import——避免 ChatManager
// 静态引用本模块时连带加载整个 memory 运行时链（v5 P0-⑧：实例在首次上卷时才装配）
import type { MemoryManagerImpl } from '../MemoryManager';

const logger = getLogger('memory:adapter:session_summary');

/** session_summary 自定义记忆类型名 */
export const SESSION_SUMMARY_MEMORY_TYPE = 'session_summary' as const;

/** 类型语义（registerMemoryType 自定义扩展通道；不改 MemoryType 封闭枚举） */
const TYPE_SEMANTICS: MemoryTypeSemantics = {
  whenToSave:
    '会话压缩阶段摘要（session/summary 事件产物），用于跨会话延续任务上下文与结论',
  howToUse:
    '检索命中时作为历史会话的阶段结论参考；需细节时提示用户或经 session_lookup 取回原文',
};

/** 上限：长期库摘要正文总长（字符；前缀/来源行计入预算） */
const CONTENT_BUDGET = 2000;
/** 下限：过短不落库（防噪声） */
const CONTENT_MIN = 20;
/** 会话 id 目录安全：禁止路径分隔与相对段（MemoryStore 以 sessionId 建目录） */
const UNSAFE_SESSION_ID = /[/\\]|\.\./;

/**
 * 注册自定义记忆类型 session_summary（幂等）。须在任何扫描/召回/统计路径之前调用
 * （进程启动/模块加载期一次）——createMemory 不校验 type，scanner 的
 * isValidMemoryType 校验才是约束面（接入文档 v5 P0-⑥/P2-4）。
 */
export function registerSessionSummaryMemoryType(): void {
  if (!isValidMemoryType(SESSION_SUMMARY_MEMORY_TYPE)) {
    registerMemoryType(SESSION_SUMMARY_MEMORY_TYPE, TYPE_SEMANTICS);
  }
}

/** adapter 输入（v5：自建类型，含 sessionId；不复用 SessionSummaryRecord） */
export interface SessionSummaryAdapterInput {
  /** 所属会话（必填） */
  sessionId: string;
  /** 摘要正文（未拼接原始 content） */
  content: string;
  /** 检索关键词（轻量词频） */
  keywords?: string[];
  /** 被折叠事件区间（幂等键主键） */
  compactedRange?: { startSeq: number; endSeq: number };
  /** 被折叠的源消息事件 seq（溯源） */
  sourceEventSeqs?: number[];
  /** session/summary 事件自身 seq（append tailSeq，溯源） */
  summarySeq?: number;
}

/** build 输出（可直接入 createMemory/updateMemory） */
export interface SessionSummaryMemoryInput {
  content: string;
  metadata: MemoryMetadata;
}

/**
 * 幂等键回退链（接入文档 v3/v4）：
 *  ① sessionId#startSeq-endSeq   （区间为主键）
 *  ② sessionId#summarySeq        （仅摘要事件 seq）
 *  ③ sessionId#c<contentHash8>   （区间与 seq 均缺失；只防同内容重复，不保证同会话收敛）
 */
export function idempotencyKey(input: SessionSummaryAdapterInput): string {
  const { sessionId, compactedRange, summarySeq, content } = input;
  if (
    compactedRange?.startSeq !== undefined &&
    compactedRange?.endSeq !== undefined
  ) {
    return `${sessionId}#${compactedRange.startSeq}-${compactedRange.endSeq}`;
  }
  if (summarySeq !== undefined && summarySeq > 0) {
    return `${sessionId}#${summarySeq}`;
  }
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 8);
  return `${sessionId}#c${hash}`;
}

function trimBudget(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= CONTENT_BUDGET) return trimmed;
  // 正文截断使总长 ≤ 预算：前缀 + 来源行固定，可截部分在 content 段——
  // 这里以整体超限即截断尾部（来源行在尾，退而截断正文：改为从内容头部回算）。
  return trimmed.slice(0, CONTENT_BUDGET).trimEnd();
}

/**
 * 纯映射：input → 落库内容与全量 metadata（便于单测）。
 * 返回 null = 守卫不通过（最终 content trim 后 < CONTENT_MIN，不入库）。
 * - 长度口径：对"拼接后的整串 trim"判长（v5 P2-2），前缀/来源行计入预算
 * - metadata 全量（v4 P1-2：upsert 覆盖防浅合并残留）
 * - metadata.sessionId 映射（v3 P0）
 * - 内容仅摘要正文，禁止携带被折叠原文片段（v5 P0-⑦）
 */
export function buildSessionSummaryMemoryInput(
  input: SessionSummaryAdapterInput
): SessionSummaryMemoryInput | null {
  const { sessionId, content, keywords, compactedRange, summarySeq } = input;
  const rawContent = content ?? '';
  // 正文下限守卫：空/过短正文不得入库（防"仅前缀+来源行"的伪记录——固定前缀
  // 与来源行会让拼接串恒 ≥20，故下限必须针对正文本身而非拼接串）
  if (rawContent.trim().length < CONTENT_MIN) return null;
  const prefix = `【会话 ${sessionId.slice(0, 8)} 阶段摘要】`;
  const source = `\n[来源] 会话 ${sessionId} · 事件区间 ${
    compactedRange ? `${compactedRange.startSeq}-${compactedRange.endSeq}` : '-'
  }${summarySeq !== undefined && summarySeq > 0 ? ` · 摘要事件 seq ${summarySeq}` : ''}`;
  const built = trimBudget(prefix + rawContent + source);
  if (built.length < CONTENT_MIN) return null;
  const now = new Date();
  return {
    content: built,
    metadata: {
      name: idempotencyKey(input),
      description:
        '会话压缩阶段摘要（跨会话长期记忆，源自 session/summary 事件）',
      type: SESSION_SUMMARY_MEMORY_TYPE,
      sessionId,
      createdAt: now,
      updatedAt: now,
      tags: ['session-summary', sessionId, ...(keywords ?? [])],
      source: 'session_compaction',
    },
  };
}

/** 长期库写入所需的最小方法面（MemoryManagerImpl 天然满足；测试可注入独立目录实例） */
export interface SessionSummaryMemorySink {
  getAllMemories(): Promise<Memory[]>;
  getMemory(id: string): Promise<Memory | null>;
  createMemory(
    memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>,
    opts?: { skipConsolidation?: boolean }
  ): Promise<Memory>;
  updateMemory(id: string, updates: Partial<Memory>): Promise<Memory>;
  deleteMemory(id: string): Promise<void>;
}

/**
 * 进程内共享实例（v5 P0-⑧）：默认复用同一 MemoryManagerImpl（同一磁盘 store +
 * 同一实例级 retriever 索引），避免每调用新建冷实例导致召回不一致与索引重复预热。
 * 测试/嵌入场景可注入独立 sink（manager 参数）。
 * lazy dynamic import：首次上卷时才装配实例，静态引用不连带加载 memory 运行时链。
 */
let sharedManager: MemoryManagerImpl | null = null;

async function getSharedManager(): Promise<MemoryManagerImpl> {
  if (!sharedManager) {
    const { MemoryManagerImpl: MMI } = await import('../MemoryManager');
    sharedManager = new MMI();
  }
  return sharedManager;
}

function isSafeSessionId(sessionId: string): boolean {
  return !!sessionId && !UNSAFE_SESSION_ID.test(sessionId);
}

/**
 * 幂等写入一条会话摘要至长期库（接入文档 v3/v4/v5 语义）。
 * @param input 摘要输入（含 sessionId）
 * @param sink 长期库写入目标（默认进程内共享 MemoryManagerImpl 实例）
 * @returns 是否成功（失败仅 warn 不抛，CS03）
 */
export async function rollupSessionSummaryToLongTerm(
  input: SessionSummaryAdapterInput,
  sink?: SessionSummaryMemorySink
): Promise<boolean> {
  try {
    registerSessionSummaryMemoryType();
    if (!isSafeSessionId(input.sessionId)) {
      logger.warn('session_summary 上卷跳过：sessionId 含不安全路径字符', {
        sessionId: input.sessionId,
      });
      return false;
    }
    const built = buildSessionSummaryMemoryInput(input);
    if (!built) {
      logger.debug('session_summary 上卷跳过：内容过短或为空', {
        sessionId: input.sessionId,
      });
      return false;
    }
    const mm: SessionSummaryMemorySink = sink ?? (await getSharedManager());
    const key = built.metadata.name;

    // 幂等查重-upsert（v2/v4）：同幂等键命中 → updateMemory 全量覆盖；未命中 → create
    const all = await mm.getAllMemories();
    const existing = all.find(
      (m) =>
        m.metadata.type === SESSION_SUMMARY_MEMORY_TYPE &&
        m.metadata.name === key
    );
    if (existing) {
      await mm.updateMemory(existing.id, {
        content: built.content,
        metadata: {
          ...built.metadata,
          createdAt: existing.metadata.createdAt ?? built.metadata.createdAt,
        },
      });
      logger.info('session_summary 上卷：同幂等键覆盖刷新', {
        sessionId: input.sessionId,
        memoryId: existing.id,
        key,
      });
      return true;
    }

    // 未命中 → 新建（skipConsolidation=true：v5 B 案——本类型去重由幂等键收敛负责，
    // 跳过全库相似度去重，避免"相似即删"误删不同键相邻阶段摘要）
    const created = await mm.createMemory(
      {
        content: built.content,
        metadata: built.metadata,
      },
      { skipConsolidation: true }
    );
    // 存在性复查（v4 A' 兜底）：createMemory 异常时可能返回 dangling id
    const persisted = await mm.getMemory(created.id);
    if (!persisted) {
      logger.warn('session_summary 上卷：写入后复查未找到，可能被去重删除', {
        sessionId: input.sessionId,
        memoryId: created.id,
        key,
      });
      return false;
    }
    logger.info('session_summary 上卷成功', {
      sessionId: input.sessionId,
      memoryId: created.id,
      key,
      length: built.content.length,
    });
    return true;
  } catch (err) {
    logger.warn('session_summary 上卷失败（不影响主流程）', {
      sessionId: input.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** rebuildForSession 结果计数 */
export interface RebuildResult {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
}

/**
 * 单会话全量对齐式重建（接入文档 v5 P1-⑦）：副本语义 = 与 events 期望集对齐。
 * E（records 由上层从该会话 events 的 session/summary 解析组装）
 * C（长期库该会话现存 session_summary）
 * C−E → 删除；E−C → 写入；E∩C → 幂等键覆盖刷新。
 * "遍历各会话"由上层驱动，本函数只做单会话（不内置跨会话枚举）。
 */
export async function rebuildForSession(
  sessionId: string,
  records: SessionSummaryAdapterInput[],
  sink?: SessionSummaryMemorySink
): Promise<RebuildResult> {
  const result: RebuildResult = {
    created: 0,
    updated: 0,
    deleted: 0,
    skipped: 0,
  };
  try {
    registerSessionSummaryMemoryType();
    if (!isSafeSessionId(sessionId)) {
      logger.warn('session_summary 重建跳过：sessionId 不安全', { sessionId });
      return result;
    }
    const mm: SessionSummaryMemorySink = sink ?? (await getSharedManager());
    const expect = new Map<string, SessionSummaryAdapterInput>();
    for (const r of records) {
      if (r.sessionId === sessionId) expect.set(idempotencyKey(r), r);
    }
    const current = (await mm.getAllMemories()).filter(
      (m) =>
        m.metadata.type === SESSION_SUMMARY_MEMORY_TYPE &&
        m.metadata.sessionId === sessionId
    );
    const currentByKey = new Map(
      current.map((m) => [m.metadata.name ?? '', m])
    );

    // C − E：长期库有、events 无 → 删除
    for (const [key, mem] of currentByKey) {
      if (!expect.has(key)) {
        await mm.deleteMemory(mem.id);
        result.deleted++;
      }
    }
    // E 对齐（E−C 新建；E∩C 覆盖）
    for (const [key, record] of expect) {
      const built = buildSessionSummaryMemoryInput(record);
      if (!built) {
        result.skipped++;
        continue;
      }
      const existing = currentByKey.get(key);
      if (existing) {
        await mm.updateMemory(existing.id, {
          content: built.content,
          metadata: {
            ...built.metadata,
            createdAt: existing.metadata.createdAt ?? built.metadata.createdAt,
          },
        });
        result.updated++;
      } else {
        await mm.createMemory(
          { content: built.content, metadata: built.metadata },
          { skipConsolidation: true }
        );
        result.created++;
      }
    }
    logger.info('session_summary 重建完成（全量对齐）', {
      sessionId,
      ...result,
    });
  } catch (err) {
    logger.warn('session_summary 重建失败', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return result;
}

/**
 * 清理会话阶段摘要（D-P1，2026-09-02，接入文档 §3.2/§4 P1）。
 * 副本清理：O(n) 全扫后逐个 deleteMemory（store 按文件存、无 type 索引）；
 * sessionId 可选——给定时只删该会话（长期库内 sessions/{sessionId}/ 语义），
 * 不给定时清全库 session_summary。注意：仅清长期库副本，不碰 events（§3.2 P1-⑧）。
 */
export async function clearSessionSummaries(
  sessionId?: string,
  sink?: SessionSummaryMemorySink
): Promise<{ deleted: number }> {
  const result = { deleted: 0 };
  try {
    const mm: SessionSummaryMemorySink = sink ?? (await getSharedManager());
    const targets = (await mm.getAllMemories()).filter(
      (m) =>
        m.metadata.type === SESSION_SUMMARY_MEMORY_TYPE &&
        (!sessionId || m.metadata.sessionId === sessionId)
    );
    for (const m of targets) {
      await mm.deleteMemory(m.id);
      result.deleted++;
    }
    logger.info('session_summary 清理完成', {
      sessionId: sessionId ?? '*',
      ...result,
    });
  } catch (err) {
    logger.warn('session_summary 清理失败', {
      sessionId: sessionId ?? '*',
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return result;
}
