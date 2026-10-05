// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * ChatBootstrap —— 启动加载 / 迁移 / 初始化（ChatManager 拆分批 A4a）
 *
 * **来源**：提取自 `ChatManager.ts` 的 C13 簇（D-01/D-03 文件规模债拆分）；
 * 方案与依赖验证见 `.trae/specs/file-size-debt-partition-plan.md` §9.3 / §13。
 *
 * **职责（单一）**：
 *   ① `ensureSessionsLoaded`：幂等加载会话（迁移 → `SessionGateway.initialize` → 从网关装载）
 *   ② 遗留数据迁移（项目路径 → `~/.pyapp/data`）与残留 PID 锁清理（启动期维护）
 *   ③ `initialize`：启动编排（LLM client / 活跃度追踪 / 生命周期事件连线 / 回滚系统 /
 *      Durable Resume 扫描与熔断）
 *   ④ `resumePendingSessions`：Durable Resume —— 扫描 DB 检查点并恢复中断会话
 *   ⑤ `loadSessionsFromGateway`：从 `SessionGateway` 装载会话与消息（含 totalMessages 重算
 *      落盘判据与衍生状态回灌）
 *
 * **⚠️ 范围说明（2026-10-05）**：A4 按 spec §3「一次只动一个文件 + 降低 blast radius」
 * 拆为 **A4a（本模块 = C13）** 与 **A4b（C18 恢复/outbox/yield，后续批次）**。
 *
 * **日志 module 名保持不变**：拆分不改变日志口径（行为等价）。
 *
 * **注入依赖**（`ChatBootstrapDeps`，全 getter ⇒ 无字段初始化顺序陷阱）：
 * 跨簇共享状态与服务（会话网关 / 会话投影 / 会话访问门面 / token 预算 / TAORLoop 工厂 /
 * LLM client / Durable Resume 开关 / 重算落盘判据）仍归宿主所有。
 */

import fs from 'fs';
import path from 'path';
import { homedir } from 'node:os';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { RollbackIntegration } from '@modules/security';
import type { SessionGateway } from '@modules/session';
import type { Message } from '@modules/session/types/message.js';
import type { ChatSession } from '@modules/session/types/session.js';
import type { TAORLoop } from '@modules/query';
import type { ToolAwareClient } from '@modules/ai';
import { mapSessionStatusToState } from '../services/ChatHelper';
import type { SessionAccessFacade } from '../services/SessionAccessFacade';
import type { TokenBudgetController } from '../../tokenBudget/TokenBudgetController.js';

const logger = getLogger('chat:manager');

/** 本模块所需的注入依赖（跨簇共享状态仍归宿主 `ChatManager` 所有，经 getter 访问） */
export interface ChatBootstrapDeps {
  /** 会话网关（初始化 / 列会话 / 取消息 / 回写） */
  getSessionGateway: () => SessionGateway;
  /** 会话投影表（与宿主共享同一 Map 实例） */
  getChatSessions: () => Map<string, ChatSession>;
  /** 会话访问门面（活跃度追踪 + 衍生状态回灌） */
  getSessionAccess: () => SessionAccessFacade;
  /** token 预算控制器（Durable Resume 完整性校验取当前用量） */
  getTokenBudget: () => TokenBudgetController;
  /** TAORLoop 工厂（Durable Resume 建循环并从检查点恢复） */
  getOrCreateTAORLoop: (sessionId: string) => TAORLoop;
  /** 全局 LLM client（可空；仅 `initialize` 触发其初始化） */
  getLlmClient: () => ToolAwareClient | undefined;
  /** Durable Resume 开关（原 `ChatManager.ENABLE_DURABLE_RESUME`） */
  isDurableResumeEnabled: () => boolean;
  /** `totalMessages` 重算落盘判据（宿主纯函数，勿在本模块重造） */
  shouldPersistRecalculatedTotal: (
    previous: number | undefined,
    recalculated: number
  ) => boolean;
}

export class ChatBootstrap {
  /** 会话是否已从磁盘加载（幂等） */
  private _sessionsLoaded = false;

  /** Durable Resume 连续失败计数（≥3 熔断） */
  private _resumeFailCount = 0;

  constructor(private readonly deps: ChatBootstrapDeps) {}

  /**
   * 确保会话已从磁盘加载（幂等）
   *
   * 与 LLM 客户端初始化解耦，使 GET /v1/sessions 等接口
   * 在首次聊天消息前即可返回持久化的会话列表。
   */
  async ensureSessionsLoaded(): Promise<void> {
    if (this._sessionsLoaded) return;
    try {
      // 迁移旧路径遗留数据到 ~/.pyapp（一次性，幂等）—— 必须在加载会话前执行，
      // 否则新复制进来的旧会话无法被本次加载识别。
      // 注：放在 ensureSessionsLoaded（启动时调用）而非 initialize（延迟 LLM 初始化），
      // 确保后端启动即完成数据统一，不依赖首次聊天。
      await this.migrateHomeFromProjectToUser();
      await this.deps.getSessionGateway().initialize();
      await this.loadSessionsFromGateway();
      this._sessionsLoaded = true;
    } catch (err) {
      await handleError(err, {
        module: 'chat:manager',
        action: 'ensureSessionsLoaded',
      });
    }
  }

  /**
   * 清理超过 24 小时的残留 PID 锁文件
   * 这些文件由非正常退出（崩溃/强杀）留下，过期后无意义
   */
  private async cleanStalePidFiles(): Promise<void> {
    try {
      const { resolveSessionsDir } = await import('@modules/core');
      const { readdirSync, statSync, unlinkSync, existsSync } = require('fs');
      const { join } = require('path');
      const pidDir = join(resolveSessionsDir(), 'pid');
      if (!existsSync(pidDir)) return;

      const now = Date.now();
      const STALE_MS = 24 * 60 * 60 * 1000; // 24 小时
      const entries = readdirSync(pidDir);
      let cleaned = 0;

      for (const entry of entries) {
        try {
          const filePath = join(pidDir, entry);
          const stat = statSync(filePath);
          if (now - stat.mtimeMs > STALE_MS) {
            unlinkSync(filePath);
            cleaned++;
          }
        } catch {
          // 单项清理失败，跳过
        }
      }

      if (cleaned > 0) {
        logger.info(`清理了 ${cleaned} 个过期 PID 锁文件`);
      }
    } catch {
      // 非关键路径，静默降级
    }
  }

  /**
   * 迁移：旧版项目路径 → 用户主目录（一次性，幂等）
   *
   * 2026-08-18 resolvePyappHome() 统一为 ~/.pyapp 后，历史遗留数据位于
   * <projectRoot>/app/data/pyapp/data，且原迁移函数因「curHome 已为主目录」
   * 的早退条件成为死代码，遗留数据从未迁移。本实现直接检测遗留路径，
   * 将新目录缺失的文件合并到 ~/.pyapp/data/，完成后写标记避免重复复制。
   *
   * 排除项（重型循环产物 / 运行时日志，避免无价值复制）：checkpoints /
   * snapshots / transcripts / logs / otel-traces / run-logs / traces /
   * backups / background / cache / analytics / artifacts / chat_sessions /
   * chronos / governance / locks / oauth / pairings / permissions /
   * security / state / team-memory / teams / tmp 及 app.db*（新库为事实来源）。
   */
  private async migrateHomeFromProjectToUser(): Promise<void> {
    try {
      const { resolveProjectRoot } = await import('@modules/core');
      const oldDataDir = path.join(
        resolveProjectRoot(),
        'app',
        'data',
        'pyapp',
        'data'
      );
      const newDataDir = path.join(homedir(), '.pyapp', 'data');
      const marker = path.join(newDataDir, '.home-migration-v1');

      if (fs.existsSync(marker)) return; // 已迁移
      if (!fs.existsSync(oldDataDir)) return; // 无遗留数据
      if (!fs.existsSync(newDataDir)) return; // 新目录未就绪

      const SKIP_TOP = new Set([
        'checkpoints',
        'snapshots',
        'transcripts',
        'logs',
        'otel-traces',
        'run-logs',
        'traces',
        'backups',
        'background',
        'cache',
        'analytics',
        'artifacts',
        'chat_sessions',
        'chronos',
        'governance',
        'locks',
        'oauth',
        'pairings',
        'permissions',
        'security',
        'state',
        'team-memory',
        'teams',
        'tmp',
        'app.db',
        'app.db-shm',
        'app.db-wal',
      ]);

      let copied = 0;
      let skipped = 0;

      const walk = (src: string, dst: string): void => {
        if (!fs.existsSync(src)) return;
        const st = fs.statSync(src);
        if (st.isDirectory()) {
          if (src.endsWith('pid')) return; // 跳过会话锁目录
          for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
            walk(path.join(src, entry.name), path.join(dst, entry.name));
          }
          return;
        }
        if (src.endsWith('-shm') || src.endsWith('-wal')) return; // SQLite 残留 journal
        if (fs.existsSync(dst)) {
          skipped++;
          return;
        }
        try {
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(src, dst);
          copied++;
        } catch {
          /* 单项失败跳过 */
        }
      };

      for (const entry of fs.readdirSync(oldDataDir, {
        withFileTypes: true,
      })) {
        if (SKIP_TOP.has(entry.name)) continue;
        walk(
          path.join(oldDataDir, entry.name),
          path.join(newDataDir, entry.name)
        );
      }

      fs.writeFileSync(marker, new Date().toISOString(), 'utf-8');
      logger.info(
        `遗留数据已从项目路径迁移到用户主目录: ${oldDataDir} → ${newDataDir}（复制 ${copied}，跳过 ${skipped}）`
      );
    } catch (err) {
      // 非致命：迁移失败不影响启动，标记未写则下次启动重试
      handleError(err, { module: 'chat:manager', action: 'migrateHome' });
    }
  }

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    this.deps.getLlmClient()?.initialize();
    await this.ensureSessionsLoaded();

    // 清理超过 24 小时的残留 PID 锁文件
    this.cleanStalePidFiles().catch((err) => {
      handleError(err, { module: 'chat:manager', action: 'cleanPidFiles' });
    });

    // 启动会话活跃度追踪（心跳 + 并发控制）
    this.deps.getSessionAccess().ensureActivityTracker();

    // 连线 SessionLifecycle 事件 → 记忆/心跳自动化
    try {
      const { getGlobalEventBus } =
        await import('../../session/lifecycle/SessionLifecycleEventBus.js');
      const { connectSessionHandlers } =
        await import('../../session/lifecycle/SessionEventHandlers.js');
      connectSessionHandlers(getGlobalEventBus());
    } catch (err) {
      // 非阻塞：事件连线失败不影响主流程
      handleError(err, {
        module: 'chat:manager',
        action: 'connectSessionHandlers',
      });
    }

    // 启动回滚系统：清理中断轮次 + 配额管理
    await RollbackIntegration.onAppStart().catch((err) => {
      logger.warn('回滚系统初始化失败', { error: String(err) });
      // @ignore-catch — handleError已处理，异步抛错无需再处理
      handleError(err, {
        module: 'chat:ChatManager',
        action: 'rollback:onAppStart',
      }).catch(() => {});
    });

    // Phase 3: Durable Resume — 扫描并恢复中断的会话（RC-D 08-09：默认启用）
    if (this.deps.isDurableResumeEnabled()) {
      await this.resumePendingSessions().catch((err) => {
        logger.warn('Durable Resume 扫描失败', { error: String(err) });
        // 熔断：连续 3 次失败后跳过自动恢复
        this._resumeFailCount = (this._resumeFailCount ?? 0) + 1;
        if (this._resumeFailCount >= 3) {
          logger.warn(
            'Durable Resume 已熔断 — 跳过后续自动恢复（需手动触发）',
            {
              failCount: this._resumeFailCount,
            }
          );
        }
      });
      // 熔断恢复：启动 1 小时后重置失败计数
      if (this._resumeFailCount && this._resumeFailCount < 3) {
        setTimeout(() => {
          this._resumeFailCount = 0;
        }, 3600_000);
      }
    } else {
      logger.info('Durable Resume 已通过 ENABLE_DURABLE_RESUME=false 关闭');
    }
  }

  /**
   * Durable Resume: 扫描 DB 中的 TAOR 检查点，恢复中断的会话。
   */
  private async resumePendingSessions(): Promise<void> {
    try {
      const { resumeManager } = await import('../../query/ResumeManager.js');
      const candidates = await resumeManager.scanPending();
      if (candidates.length === 0) {
        logger.info('Durable Resume: 无待恢复会话');
        return;
      }

      logger.info('Durable Resume: 发现待恢复会话', {
        count: candidates.length,
        sessions: candidates.map((c) => c.sessionId),
      });

      for (const candidate of candidates) {
        try {
          const cp = candidate.checkpoint;
          // P0 修复（2026-08-14 排查）：空 sessionId 检查点直接跳过——脏数据
          // 若进入 _getOrCreateTAORLoop 会抛错中断整个恢复循环，此处防御性拦截
          if (!cp.sessionId) {
            logger.warn('Durable Resume: 跳过空 sessionId 检查点', {
              checkpointId: cp.id,
            });
            continue;
          }
          logger.info('Durable Resume: 恢复会话', {
            sessionId: cp.sessionId,
            checkpointId: cp.id,
            turnCount: cp.turnCount,
            phase: cp.phase,
            age: candidate.age,
          });

          // Phase 3: 进度事件
          resumeManager.emitProgress({
            phase: 'validating',
            sessionId: cp.sessionId,
            detail: `校验检查点 ${cp.id}...`,
          });
          const msgs = await this.deps
            .getSessionGateway()
            .getMessages(cp.sessionId);
          const integrity = resumeManager.validateCheckpointIntegrity(
            cp,
            msgs.length,
            this.deps.getTokenBudget().getCurrentBudgetState().totalTokensUsed
          );
          const strategy = resumeManager.getRestoreStrategy(integrity);

          logger.info('Durable Resume: 完整性校验完成', {
            sessionId: cp.sessionId,
            ...strategy,
          });

          // 创建 TAORLoop 并从检查点恢复
          const taorLoop = this.deps.getOrCreateTAORLoop(cp.sessionId);
          taorLoop.resumeFromCheckpoint(cp.id);

          // 注入恢复摘要 steering 消息
          const summary = [
            '[系统] 会话已从断点恢复。',
            `- 恢复时间点: ${new Date(cp.createdAt).toISOString()}`,
            `- 恢复阶段: ${cp.phase}（消息历史第 ${cp.turnCount} 轮）`,
            `- 恢复策略: ${strategy.reason}`,
            cp.inboxState
              ? `- Inbox 关联: ${cp.inboxState.pendingInboxItems.length} 项审批待处理`
              : '',
          ]
            .filter(Boolean)
            .join('\n');
          taorLoop.injectSteering(summary);

          logger.info('Durable Resume: 会话恢复完成', {
            sessionId: cp.sessionId,
            phase: cp.phase,
          });
        } catch (sessionErr) {
          logger.warn('Durable Resume: 单个会话恢复失败', {
            sessionId: candidate.sessionId,
            error: String(sessionErr),
          });
          // 不阻塞其他会话的恢复
        }
      }
    } catch (e) {
      handleError(e, {
        module: 'chat:manager',
        action: 'Durable Resume扫描待处理失败',
      });
      throw e;
    }
  }

  private async loadSessionsFromGateway(): Promise<void> {
    try {
      const storedSessions = await this.deps.getSessionGateway().listSessions();
      for (const stored of storedSessions) {
        if (this.deps.getChatSessions().has(stored.id)) continue;
        try {
          const storedMessages = await this.deps
            .getSessionGateway()
            .getMessages(stored.id);
          const messages: Message[] = storedMessages.map((m) => {
            let content: string;
            if (typeof m.content === 'string') {
              content = m.content;
            } else if (Array.isArray(m.content)) {
              const textBlocks = m.content.filter((b) => b.type === 'text');
              if (textBlocks.length > 0) {
                content = textBlocks
                  .map((b) => (b as { type: 'text'; text: string }).text)
                  .join('');
              } else {
                const toolResultBlock = m.content.find(
                  (b) => b.type === 'tool_result'
                );
                content = toolResultBlock
                  ? (
                      toolResultBlock as {
                        type: 'tool_result';
                        content: string;
                      }
                    ).content || ''
                  : '';
              }
            } else {
              content = '';
            }
            return {
              id: m.id,
              role: m.role,
              content,
              createdAt: new Date(m.timestamp),
              updatedAt: new Date(m.timestamp),
              sessionId: stored.id,
              toolCallId: m.metadata?.toolCallId,
              metadata: m.metadata as Record<string, unknown> | undefined,
              blocks: m.blocks as unknown as
                | Record<string, unknown>[]
                | undefined,
              tool_calls: m.metadata?.tool_calls,
            } as Message;
          });
          // 按消息 ID 去重（保留最后一份，它包含 blocks）
          const dedupMap = new Map<string, Message>();
          for (const msg of messages) {
            dedupMap.set(msg.id, msg);
          }
          const dedupedMessages = Array.from(dedupMap.values());
          // 从最新消息时间戳推导 updatedAt（磁盘上的 updatedAt 从未被更新，重启后恒为创建时间）
          let latestTimestamp = new Date(stored.updatedAt || stored.createdAt);
          for (const msg of dedupedMessages) {
            if (msg.createdAt > latestTimestamp) {
              latestTimestamp = msg.createdAt;
            }
          }
          const chatSession: ChatSession = {
            id: stored.id,
            title: stored.title,
            state: mapSessionStatusToState(stored.status),
            metadata: {
              ...stored.metadata,
              title:
                stored.title ||
                (typeof stored.metadata?.title === 'string'
                  ? stored.metadata.title
                  : '') ||
                '',
              totalMessages: dedupedMessages.length,
              lastActivityAt: new Date(stored.lastActivityAt),
            },
            messages: dedupedMessages,
            createdAt: new Date(stored.createdAt),
            updatedAt: latestTimestamp,
          };
          this.deps.getChatSessions().set(stored.id, chatSession);

          // P2-7：崩溃恢复重算 totalMessages 落盘——崩溃时 metadata.totalMessages
          // 可能停留在崩溃前旧值（仅写内存则每次重启都重算）；与去重后实际消息数
          // 不一致时经 sessionGateway.updateSession 回写磁盘（注意：updateSession
          // 内部会把 updatedAt 置为当前时间，此为一次性数据修复的已知副作用）。
          //
          // ①-1b（2026-09-26，`.trash` 高速累积根因）：**重算结果为空时不再落盘**——
          // 消息文件丢失时 dedupedMessages 恒为 []，落盘只会把"文件已丢失"固化成
          // `totalMessages: 0` 并掩盖真相（旧实现还会借 mkdir 把已软删目录重建 ⇒ 与
          // K-6 自愈构成无终止循环）。判据见纯函数 shouldPersistRecalculatedTotal。
          if (stored.metadata?.totalMessages !== dedupedMessages.length) {
            if (
              this.deps.shouldPersistRecalculatedTotal(
                stored.metadata?.totalMessages,
                dedupedMessages.length
              )
            ) {
              try {
                await this.deps.getSessionGateway().updateSession({
                  ...stored,
                  metadata: {
                    ...stored.metadata,
                    totalMessages: dedupedMessages.length,
                  },
                });
                logger.info('chat:manager 崩溃恢复重算 totalMessages 落盘', {
                  sessionId: stored.id,
                  before: stored.metadata?.totalMessages,
                  after: dedupedMessages.length,
                });
              } catch (err) {
                logger.warn(
                  'chat:manager totalMessages 回写失败（不影响本次加载）',
                  {
                    sessionId: stored.id,
                    error: err instanceof Error ? err.message : String(err),
                  }
                );
              }
            } else {
              logger.warn(
                'chat:manager 崩溃恢复重算结果为空,跳过落盘（疑消息文件丢失,避免固化为 0）',
                {
                  sessionId: stored.id,
                  before: stored.metadata?.totalMessages,
                  after: dedupedMessages.length,
                }
              );
            }
          }

          // Session State Hydration: 从 transcript 恢复衍生状态
          // ⚠️ 2026-09-29（台账 c2）：原 `hydrated.todos` / `hydratedTodos` 已删 ——
          // `extractTodos` 实测**永不命中**，且 `hydratedTodos` 全仓**零读取方**（只写不读）。
          try {
            const hydrated = this.deps
              .getSessionAccess()
              .hydrateSession(chatSession);
            if ((hydrated.recentFiles?.length ?? 0) > 0) {
              chatSession.metadata = {
                ...chatSession.metadata,
                hydratedRecentFiles: hydrated.recentFiles,
                hydratedDecisions: hydrated.recentDecisions,
              };
            }
          } catch (err) {
            // 回灌失败不影响会话加载
            handleError(err, {
              module: 'chat:manager',
              action: 'hydrateDecisions_loadSession',
            });
          }
        } catch (e) {
          logger.warn('加载单个会话失败，跳过', {
            sessionId: stored.id,
            error: String(e),
          });
          continue;
        }
      }
    } catch (e) {
      handleError(e, {
        module: 'chat:manager',
        action: '从Gateway加载会话失败',
      });
    }
  }
}
