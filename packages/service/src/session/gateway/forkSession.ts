/**
 * gateway/forkSession.ts — 事件级 fork 的实现外移（2026-11-28，R04-001 行数门禁）
 *
 * **来源**：`SessionGateway.forkSession` + 私有 `rollbackForkedChild`（**逐字搬迁**；唯一改动是把
 * `this.getSession/createSession/deleteSession` 换成 `deps.*`、`this.config.storageConfig.basePath`
 * 换成 `deps.storageBasePath`）。
 *
 * **行为不变红线**：边界解析 / 未闭合轮次校验 / 血缘环与深度闸 / 元数据对账 / 前缀同构校验 /
 * 回滚（软删除子会话）语义与日志 module（`session:gateway`）逐字未变。
 *
 * D3（2026-08-24）：从任意历史 seq（boundary）fork 出子会话。
 * 流程：
 *   1. 读源会话 + 源事件（read 自动触发 D4 崩溃修复，保证复制一致性）
 *   2. 定 boundary：显式 `boundary`（默认 = tailSeq，须为 [1..tailSeq] 内整数），
 *      或由 `truncateBeforeMessageId` 在源事件上解析（见 `resolveBoundaryBeforeMessage`）
 *   3. open turn 校验：seq ≤ boundary 内存在未闭合 turn/start → 拒绝
 *   4. createSession 建子会话（metadata 注入 parentSessionId/seedLength 血缘）
 *   5. copyPrefixTo 复制 [1..boundary] 前缀事件（保留原 seq，子会话继承祖先 seq 空间）；
 *      `boundary === 0`（截断点之前无历史）⇒ 零种子，不复制
 *
 * 返回结果对象（不抛错，对齐网关既有模式）；HTTP 层据此映射 4xx/201。
 */

import path from 'path';

import { getLogger, getOTelTracing } from '@openliri/infra/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@openliri/infra/error';
import { resolveWorktreeHash } from '@openliri/infra/environment';

import { EventLogStorage } from '../storage/EventLogStorage';
// O10b（v7.1）：Tier1 血缘链（fork 时登记，供控制面祖先判定）
import {
  registerSessionLineage,
  wouldCreateLineageCycle,
  getLineageDepth,
  MAX_LINEAGE_HOPS,
} from '../lineage/sessionLineage';
// fork 前置的**源会话**解析与校验（边界解析 / 未闭合轮次校验 / 前缀同构校验；
// 一律分页读全前缀，免受 read() 的 1000 条窗口截断）
import {
  resolveBoundaryBeforeMessage,
  findOpenTurnInPrefix,
  comparePrefixIsomorphic,
} from './ForkBoundary.js';
import type {
  CreateSessionParams,
  UnifiedSession,
} from '../types/UnifiedSession.js';
import type { SessionSource } from '../key/SessionSource.js';

const logger = getLogger('session:gateway');

/** fork 选项（与网关公开签名逐字一致） */
export interface ForkSessionOptions {
  boundary?: number;
  childTitle?: string;
  childId?: string;
  /**
   * 「编辑并另存为分支」：只保留该消息**之前**的历史（在源会话事件上解析边界）。
   * 传入时**优先于** `boundary`；解析不出（消息不在事件日志）即失败，不猜测。
   */
  truncateBeforeMessageId?: string;
}

/** fork 结果（与原内联返回类型逐字一致） */
export interface ForkSessionResult {
  success: boolean;
  session?: UnifiedSession;
  boundary?: number;
  copied?: number;
  error?: string;
}

/** 外移所需的宿主端口（全部来自 `SessionGateway`，调用点单点断言） */
export interface ForkSessionDeps {
  getSession(sessionId: string): Promise<UnifiedSession | null>;
  createSession(
    params: CreateSessionParams & {
      userId?: string;
      chatType?: string;
      sessionSource?: SessionSource;
    }
  ): Promise<UnifiedSession>;
  deleteSession(sessionId: string): Promise<void>;
  /** 存储 basePath（事件日志分区派生用）；缺省 ⇒ 回退 worktreeHash 单一真源 */
  storageBasePath?: string;
}

export async function forkSessionFrom(
  sourceId: string,
  options: ForkSessionOptions,
  deps: ForkSessionDeps
): Promise<ForkSessionResult> {
  const otel = getOTelTracing();
  const span = otel.startSpan('SessionGateway.forkSession');
  const startedAt = Date.now();
  logger.debug('forkSession:入口', {
    sourceId,
    boundary: options.boundary ?? null,
    truncateBeforeMessageId: options.truncateBeforeMessageId ?? null,
    childTitle: options.childTitle ?? null,
  });

  try {
    const source = await deps.getSession(sourceId);
    if (!source) {
      return {
        success: false,
        error: `source session not found: ${sourceId}`,
      };
    }

    // 事件日志路径与存储层对齐：从 storageConfig.basePath（<root>/sessions/<hash>）
    // 派生 sessionsRoot=<root>/sessions + worktreeHash=<hash>；未配置 basePath 时回退到
    // **worktreeHash 单一真源**（N-52 同族修复，2026-09-22）—— 原为字面量 `'default'`，
    // 会让 sourceLog 指向空分区 ⇒ `read()` 空、`tailSeq=0` ⇒ fork 恒被 `invalid boundary` 拒绝。
    const basePath = deps.storageBasePath;
    const sessionsRoot = basePath ? path.dirname(basePath) : undefined;
    const worktreeHash = basePath
      ? path.basename(basePath)
      : resolveWorktreeHash();
    const sourceLog = new EventLogStorage(
      sourceId,
      worktreeHash,
      sessionsRoot
    );
    const tailSeq = await sourceLog.getTailSeq();

    // boundary 的两条来源：① 显式 seq（缺省 = tailSeq，须在 [1..tailSeq] 内）；
    // ② 「编辑点之前」—— 按源事件解析（优先），`0` = 截断点之前无历史 ⇒ 零种子 fork。
    // 两处解析/校验一律**分页读全前缀**（`read()` 缺省 limit=1000 会截断 ⇒ 长会话误判，
    // 见 gateway/ForkBoundary.ts 头注与台账 FORK-PREFIX-WINDOW）。
    let boundary: number;
    if (options.truncateBeforeMessageId) {
      const resolved = await resolveBoundaryBeforeMessage(
        sourceLog,
        options.truncateBeforeMessageId
      );
      if (resolved === null) {
        return {
          success: false,
          error: `truncate-before message not in event log: ${options.truncateBeforeMessageId}`,
        };
      }
      boundary = resolved;
      logger.debug('forkSession:截断边界由源事件解析', {
        sourceId,
        truncateBeforeMessageId: options.truncateBeforeMessageId,
        boundary,
        tailSeq,
      });
    } else {
      boundary = options.boundary ?? tailSeq;
      if (!Number.isInteger(boundary) || boundary <= 0 || boundary > tailSeq) {
        return {
          success: false,
          error: `invalid boundary: ${boundary} (tailSeq=${tailSeq})`,
        };
      }
    }

    // open turn 校验：boundary 落在未闭合轮次内 → 拒绝（复制残缺 turn 无意义）
    const openTurn =
      boundary > 0 ? await findOpenTurnInPrefix(sourceLog, boundary) : null;
    if (openTurn) {
      return {
        success: false,
        error: `open turn at seq ${openTurn.seq} blocks fork boundary ${boundary}`,
      };
    }

    // P1-10（C 判据，2026-09-25）：建边**前置**校验 —— 防血缘环与超深链。
    // 环的两个来源：① 显式 `childId` 已是 source 的**祖先** ⇒ 新边让两者互为祖先
    // （控制面 Tier1 会互相授予控制权）；② 自环（`childId === sourceId`）。
    // 深链：新边后深度超过 `MAX_LINEAGE_HOPS` ⇒ `isAncestorSession` 会判否，
    // 与其建一条"查不到"的边，不如建边即拒绝。
    if (options.childId && wouldCreateLineageCycle(options.childId, sourceId)) {
      return {
        success: false,
        error: `fork would create lineage cycle: child=${options.childId} parent=${sourceId}`,
      };
    }
    const sourceDepth = getLineageDepth(sourceId);
    if (sourceDepth + 1 > MAX_LINEAGE_HOPS) {
      return {
        success: false,
        error: `fork exceeds max lineage hops: ${sourceDepth} + 1 > ${MAX_LINEAGE_HOPS}`,
      };
    }

    // 创建子会话（血缘注入 metadata，复用 createSession 的落盘 + session:created 事件）
    //
    // 2026-10-16：**显式给标题起名时锁标题**（「另存为分支」的 `分支：X`）。子会话若不带
    // 任何标题标记，`SessionTitling.shouldAutoTitle()` 判其可自动命名 ⇒ 首轮先被**占位标题**
    // （取首条用户消息）覆盖、再被 **LLM 精化**覆盖 ⇒ 分支身份在标题上消失（真机三段标题链：
    // `分支：边界终验需求澄清` → `你好-边界终验-分支B` → `边界终验分支B验证`）。
    // 口径**复用** `SessionTitling.renameSession(source='user')` 的字段组合（titleStage='manual'
    // + titleLocked=true + titleAutoGenerated=true + metadata.title），不新增机制（CS01）。
    // 未给 childTitle 的 fork（如程序化建分支）保持原行为，不锁。
    const branchTitle =
      typeof options.childTitle === 'string' && options.childTitle.trim() !== ''
        ? options.childTitle
        : undefined;
    const child = await deps.createSession({
      id: options.childId,
      title: options.childTitle,
      metadata: {
        parentSessionId: sourceId,
        seedLength: boundary,
        ...(branchTitle
          ? {
              titleStage: 'manual',
              titleLocked: true,
              titleAutoGenerated: true,
              title: branchTitle,
            }
          : {}),
      },
    });

    // 复制前缀事件到子会话（保留原 seq）
    const childLog = new EventLogStorage(child.id, worktreeHash, sessionsRoot);
    const copy = await sourceLog.copyPrefixTo(childLog, boundary);
    if (!copy.ok) {
      // H9 修复：复制失败时回滚已创建的子会话（deleteSession 软删除），
      // 避免孤儿子会话残留（无血缘事件、后续 fork 校验不一致）。
      // 血缘此时**尚未登记**（M-2 后置）⇒ 不产生悬挂边。
      await rollbackForkedChild(deps, child.id, 'copy-failed');
      return {
        success: false,
        session: child,
        boundary,
        copied: copy.copied,
        error: `copy prefix failed: ${copy.reason ?? 'unknown'}`,
      };
    }

    // P1-10（A 判据，2026-09-25）：**声明 = 事实** —— 实际复制上界必须等于请求边界。
    // 严格口径（用户裁定）：不一致即回滚拒绝。触发场景：源存在 seq 空洞、
    // 损坏行被 repair 跳过、或源在复制期间被截断 ⇒ 子会话的实际种子长度短于声明。
    if (copy.maxCopiedSeq !== boundary) {
      await rollbackForkedChild(deps, child.id, 'boundary-mismatch');
      return {
        success: false,
        session: child,
        boundary,
        copied: copy.copied,
        error: `fork boundary mismatch: requested=${boundary} actual=${copy.maxCopiedSeq}`,
      };
    }

    // P1-10（A-③④）：落盘血缘（`metadata`）必须与真实来源/边界一致 —— 在登记内存血缘
    // **之前**校验。二者是两处独立写入（createSession 落盘 vs 本模块 Map 登记），
    // 一旦漂移，内存血缘**无撤销 API** ⇒ 必须前置失败（fail-closed）。
    const childMeta = child.metadata as
      | { parentSessionId?: string; seedLength?: number }
      | undefined;
    if (
      childMeta?.parentSessionId !== sourceId ||
      childMeta?.seedLength !== copy.maxCopiedSeq
    ) {
      await rollbackForkedChild(deps, child.id, 'metadata-mismatch');
      return {
        success: false,
        session: child,
        boundary,
        copied: copy.copied,
        error:
          `fork metadata mismatch: parentSessionId=${childMeta?.parentSessionId ?? 'null'}` +
          ` seedLength=${childMeta?.seedLength ?? 'null'}`,
      };
    }

    // P1-10（B 判据）：前缀**逐条同构** —— 内容一致，而非仅"上界一致"。
    // 两侧**重读磁盘**（不复用入口的内存快照）：`copyPrefixTo` 内部先
    // `ensureRepairChecked()` 修复源（torn-tail 截断），重读才与复制时的真实内容对齐。
    // 2026-10-16：改为两侧惰性游标**分页**比对 —— 原实现各读一份 `read()` 窗口（默认 1000）
    // ⇒ 长前缀下"比较"退化为对截断片段的自比（校验失效），见 ForkBoundary.ts 头注。
    const iso = await comparePrefixIsomorphic(sourceLog, childLog, boundary);
    if (!iso.ok) {
      await rollbackForkedChild(deps, child.id, 'prefix-not-isomorphic');
      return {
        success: false,
        session: child,
        boundary,
        copied: copy.copied,
        error: `fork prefix mismatch: ${iso.detail ?? 'unknown'}`,
      };
    }

    // O10b / **M-2（2026-09-22）**：血缘登记**后置到复制成功之后**。
    //
    // 修复前登记在 `copyPrefixTo` **之前**（原 `:746`），而失败分支只 `deleteSession(child.id)`
    // 回滚会话、**不撤销血缘**（全仓亦无 `unregisterSessionLineage`）⇒ 留下
    // "子会话已软删、血缘仍指向它"的**悬挂边**：控制面 Tier1 祖先判定会据此把
    // 一个已不存在的会话当成合法祖先链的一环。
    //
    // 现口径：**只有 fork 真正成功才建立血缘** ⇒ 失败即无血缘、无悬挂边。
    registerSessionLineage(child.id, sourceId);

    logger.info('会话 fork 完成', {
      sourceId,
      childId: child.id,
      boundary,
      copied: copy.copied,
      costMs: Date.now() - startedAt,
    });
    otel.endSpan(span);
    return {
      success: true,
      session: child,
      boundary,
      copied: copy.copied,
    };
  } catch (e) {
    logger.warn('forkSession:失败', {
      sourceId,
      options,
      error: e instanceof Error ? e.message : String(e),
      costMs: Date.now() - startedAt,
    });
    otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
    otel.endSpan(span, SpanStatusCode.ERROR);
    await handleError(e, {
      module: 'session:gateway',
      action: 'forkSession',
    }).catch(() => {});
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * P1-10（2026-09-25）：fork 失败时回滚已创建的子会话 —— H9 语义的**单一实现**。
 *
 * 只在**登记血缘之前**的失败点调用：血缘后置登记（M-2）保证"失败即无血缘"，
 * 故此处无需（也无 API）撤销血缘。
 */
async function rollbackForkedChild(
  deps: ForkSessionDeps,
  childId: string,
  reason: string
): Promise<void> {
  await deps.deleteSession(childId).catch((rollbackErr) => {
    logger.warn('forkSession:回滚子会话失败', {
      childId,
      reason,
      error:
        rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
    });
  });
}
