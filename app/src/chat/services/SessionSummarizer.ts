// MIT License
// Copyright (c) 2026 190615273@qq.com

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { getOTelTracing } from '@modules/monitoring/otel';
import { resolveDataDir } from '@modules/core/paths';
import { join } from 'path';
import type { ChatSession } from '../types/session.js';
import type { Message } from '../types/message.js';
import type { ToolAwareClient } from '@modules/ai';
import { trackUsage } from '@modules/ai';
import { extractModelFromResponse } from '@modules/ai';

const logger = getLogger('chat:summarizer');

interface SummaryEntry {
  sessionId: string;
  summary: string;
  messageCount: number;
  createdAt: string;
  decision?: string;
  phaseSummary?: boolean;
}

/**
 * 会话摘要生成器
 * 提取自 ChatManager._generateSessionSummary（L3292-L3510）
 *
 * 三级沉淀：
 * 1. 会话摘要 — 每轮对话后生成，提取式 + LLM 接口
 * 2. 决策记录 — 检测用户做出选择/决定时自动提取
 * 3. 阶段性小结 — 同一项目累计 3 次会话摘要后触发
 */
export class SessionSummarizer {
  constructor(private llmClient: ToolAwareClient | undefined) {}

  /**
   * 生成会话摘要 + 决策记录 + 阶段性小结
   * 持久化到 projects/<id>/summaries.json
   */
  async summarize(
    session: ChatSession,
    assistantMessage: Message
  ): Promise<void> {
    const messageCount = session.messages?.length ?? 0;
    if (messageCount < 3) return;

    const otel = getOTelTracing();
    const span = otel.startSpan('chat:summarize', {
      'session.id': session.id,
      'message.count': messageCount,
    });

    const projectId = session.metadata?.projectId as string | undefined;

    try {
      span.addEvent('summarize.start', {
        messageCount: session.messages?.length ?? 0,
      });
      if (!projectId) return;

      // S2: 惰性迁移
      try {
        const { ProjectItemStore } =
          await import('../../workspace/ProjectItemStore.js');
        const itemStore = new ProjectItemStore(projectId);
        if (itemStore.needsMigration()) {
          await itemStore.initialize();
          const { migrated } = await itemStore.migrateFromLegacy();
          if (migrated > 0) {
            logger.info('S2 惰性迁移完成', { projectId, migrated });
          }
          await itemStore.close();
        }
      } catch {
        /* 迁移失败不影响 */
      }

      const messages = session.messages ?? [];
      let lastUserContent = '';
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          lastUserContent =
            ((messages[i] as unknown as Record<string, unknown>)
              .content as string) ?? '';
          break;
        }
      }

      const assistantContent =
        typeof assistantMessage.content === 'string'
          ? assistantMessage.content
          : '';

      // ─── 0. 5 分钟合并检查（避免重复 LLM 调用）───
      const {
        readFileSync: _readFs,
        writeFileSync: _writeFs,
        existsSync: _existsFs,
        mkdirSync: _mkdirFs,
      } = await import('fs');
      const projDir = join(resolveDataDir(), 'projects', projectId);
      if (!_existsFs(projDir)) {
        _mkdirFs(projDir, { recursive: true });
      }
      const summariesPath = join(projDir, 'summaries.json');
      // E-2 修复：加载摘要——已迁移（summaries.json 被改名 .bak）时从 items.db 读，
      // 否则迁移后重建 json 与 items.db 永久分裂，旧摘要永远不可见（AI 记忆丢失）。
      let summaries: SummaryEntry[] = await this._loadSummaries(
        projectId,
        summariesPath
      );

      if (summaries.some((s) => s.sessionId === session.id)) return;

      const lastSessionSummary = summaries
        .filter((s) => !s.phaseSummary)
        .slice(-1)[0];
      if (lastSessionSummary) {
        const lastTime = new Date(lastSessionSummary.createdAt).getTime();
        if (Date.now() - lastTime < 5 * 60 * 1000) {
          // 合并到上一条摘要：跳过 LLM 调用，仅更新消息计数
          lastSessionSummary.messageCount += messageCount;
          lastSessionSummary.createdAt = new Date().toISOString();
          await this._saveSummaries(projectId, summariesPath, summaries);
          logger.debug('S6 5分钟内连续会话，合并摘要（跳过 LLM）', {
            sessionId: session.id,
            mergedInto: lastSessionSummary.sessionId,
          });
          return;
        }
      }

      // ─── 1. 会话摘要（LLM 优先，提取式兜底） ───
      const userBrief = lastUserContent.slice(0, 500).replace(/\n/g, ' ');
      const aiBrief = assistantContent.slice(0, 500).replace(/\n/g, ' ');

      let summary = lastUserContent
        ? `用户问"${userBrief.slice(0, 80)}${lastUserContent.length > 80 ? '...' : ''}" — AI 回应：${aiBrief.slice(0, 120)}${assistantContent.length > 120 ? '...' : ''}`
        : aiBrief.slice(0, 200);

      // 尝试 LLM 摘要
      if (this.llmClient) {
        const _summarizeStart = Date.now();
        try {
          const llmResponse = await this.llmClient.chat([
            {
              role: 'system' as const,
              content:
                '你是一个项目助理。用1-2句话概括以下对话的核心内容（不含任何前缀，直接输出摘要）：',
            },
            {
              role: 'user' as const,
              content: `用户：${userBrief}\nAI：${aiBrief}`,
            },
          ]);
          // Token 追踪：ToolAwareClient.chat 直调 provider 不经过 Pipeline，需显式上报
          void trackUsage(llmResponse, {
            model: extractModelFromResponse(llmResponse, 'unknown'),
            providerId: this.llmClient.providerId,
            latencyMs: Date.now() - _summarizeStart,
            sessionId: session.id,
          });
          const llmSummary = (llmResponse.content as string)?.trim();
          if (llmSummary && llmSummary.length > 5) {
            summary = llmSummary;
          }
        } catch (llmErr) {
          // KB-SUMM-LLM（2026-08-29）：LLM 摘要失败回退提取式——质量降级事件需可排查
          logger.warn('LLM 摘要生成失败，回退提取式', {
            sessionId: session.id,
            error: llmErr instanceof Error ? llmErr.message : String(llmErr),
          });
        }
      }

      // ─── 2. 决策检测 ───
      let decision: string | null = null;
      const decisionKeywords =
        /(决定|选择|采用|确定|选定)(?!不了|不下来|哪个|什么|谁|怎样|如何)/;
      if (decisionKeywords.test(lastUserContent)) {
        const decisionMatch = lastUserContent.match(
          /(?:决定|选择|采用|确定|选定).{0,50}/
        );
        if (decisionMatch) {
          decision = `用户决定：${decisionMatch[0].slice(0, 100)}`;
        }
      }

      // ─── 3. 持久化 ───
      const entry: SummaryEntry = {
        sessionId: session.id,
        summary,
        messageCount,
        createdAt: new Date().toISOString(),
      };
      if (decision) {
        entry.decision = decision;
      }
      summaries.push(entry);

      // ─── 3. 阶段性小结（3 次会话后触发） ───
      const sessionSummaries = summaries.filter((s) => !s.phaseSummary);
      if (sessionSummaries.length >= 3 && sessionSummaries.length % 3 === 0) {
        const recentSummaries = sessionSummaries.slice(-3);
        const phaseText = recentSummaries
          .map((s, i) => `${i + 1}. ${s.summary}`)
          .join('\n');

        let phaseSummary = `项目阶段性小结（最近 ${recentSummaries.length} 次会话）：
${phaseText}`;

        // 尝试 LLM 生成综合摘要
        if (this.llmClient) {
          const _phaseStart = Date.now();
          try {
            const llmResponse = await this.llmClient.chat([
              {
                role: 'system' as const,
                content:
                  '你是一个项目助理。根据以下最近几次会话摘要，写一段3-5句话的项目阶段性小结，概括主要进展、关键决策和待办事项。',
              },
              { role: 'user' as const, content: phaseText },
            ]);
            // Token 追踪：同会话摘要——ToolAwareClient 直调 provider 需显式上报
            void trackUsage(llmResponse, {
              model: extractModelFromResponse(llmResponse, 'unknown'),
              providerId: this.llmClient.providerId,
              latencyMs: Date.now() - _phaseStart,
              sessionId: session.id,
            });
            const llmPhaseSummary = (llmResponse.content as string)?.trim();
            if (llmPhaseSummary && llmPhaseSummary.length > 10) {
              phaseSummary = `项目阶段性小结（最近 ${recentSummaries.length} 次会话）：
${llmPhaseSummary}`;
            }
          } catch (phaseErr) {
            // KB-SUMM-PHASE（2026-08-29）：LLM 阶段性小结失败回退拼接——质量降级需可排查
            logger.warn('LLM 阶段性小结生成失败，回退拼接', {
              sessionId: session.id,
              error:
                phaseErr instanceof Error ? phaseErr.message : String(phaseErr),
            });
          }
        }

        summaries.push({
          sessionId: `phase_${Date.now()}`,
          summary: phaseSummary,
          messageCount: recentSummaries.reduce(
            (sum, s) => sum + s.messageCount,
            0
          ),
          createdAt: new Date().toISOString(),
          phaseSummary: true,
        });

        logger.info('S6 阶段性小结已生成', {
          projectId,
          sessionCount: sessionSummaries.length,
        });
      }

      if (summaries.length > 50) {
        summaries = summaries.slice(-50);
      }

      // E-2 修复：按迁移状态分流写入（json 存在写 json；已迁移写 items.db）
      await this._saveSummaries(projectId, summariesPath, summaries);

      const hasDecision = decision ? ' + 决策' : '';
      logger.info(`S6 会话摘要已生成${hasDecision}`, {
        sessionId: session.id,
        projectId,
        messageCount,
        totalSummaries: sessionSummaries.length + 1,
      });
    } catch (e) {
      await handleError(e, {
        module: 'chat:summarizer',
        action: 'summarize',
        context: {
          sessionId: session.id,
          projectId,
        },
      });
    } finally {
      try {
        otel.endSpan(span);
      } catch {
        /* span 可能已结束 */
      }
    }
  }

  /**
   * E-2 修复：加载摘要。
   * summaries.json 存在（未迁移）读 json；不存在（已迁移，文件已改名 .bak）回退 items.db
   * （kind='context', type='summary'，content 存 SummaryEntry 的 JSON）。
   */
  private async _loadSummaries(
    projectId: string,
    summariesPath: string
  ): Promise<SummaryEntry[]> {
    const { existsSync, readFileSync } = await import('fs');
    if (existsSync(summariesPath)) {
      try {
        return JSON.parse(readFileSync(summariesPath, 'utf-8'));
      } catch (readErr) {
        // KB-SUMM-LOAD（2026-08-29）：summaries.json 损坏 → 摘要数据静默丢失
        logger.warn('摘要文件读取/解析失败，返回空', {
          summariesPath,
          error: readErr instanceof Error ? readErr.message : String(readErr),
        });
        return [];
      }
    }
    try {
      const { ProjectItemStore } =
        await import('../../workspace/ProjectItemStore.js');
      const itemStore = new ProjectItemStore(projectId);
      try {
        await itemStore.initialize();
        const items = await itemStore.list('context');
        return items
          .filter((i) => i.type === 'summary')
          .map((i) => {
            try {
              return JSON.parse(i.content) as SummaryEntry;
            } catch {
              return null;
            }
          })
          .filter((x): x is SummaryEntry => x !== null);
      } finally {
        await itemStore.close().catch(() => {});
      }
    } catch (loadErr) {
      // KB-SUMM-DB（2026-08-29）：items.db 回退路径失败 → 摘要静默丢失
      logger.warn('摘要加载（items.db 回退路径）失败，返回空', {
        projectId,
        error: loadErr instanceof Error ? loadErr.message : String(loadErr),
      });
      return [];
    }
  }

  /**
   * E-2 修复：保存摘要。
   * summaries.json 存在（未迁移）写 json；不存在（已迁移）写 items.db 全量覆盖，
   * 与 _loadSummaries 的映射对称。
   */
  private async _saveSummaries(
    projectId: string,
    summariesPath: string,
    summaries: SummaryEntry[]
  ): Promise<void> {
    const { existsSync, writeFileSync } = await import('fs');
    if (existsSync(summariesPath)) {
      writeFileSync(summariesPath, JSON.stringify(summaries, null, 2), 'utf-8');
      return;
    }
    try {
      const { ProjectItemStore } =
        await import('../../workspace/ProjectItemStore.js');
      const itemStore = new ProjectItemStore(projectId);
      try {
        await itemStore.initialize();
        await itemStore.upsertBatch(
          summaries.map((s) => ({
            id: s.sessionId,
            projectId,
            kind: 'context' as const,
            type: 'summary',
            title: s.phaseSummary ? 'phase_summary' : 'summary',
            content: JSON.stringify(s),
            createdAt: s.createdAt,
            updatedAt: new Date().toISOString(),
          }))
        );
      } finally {
        await itemStore.close().catch(() => {});
      }
    } catch (e) {
      // @ignore-catch 已迁移分支写入失败仅记录，不阻断摘要主流程
      handleError(e, {
        module: 'chat:summarizer',
        action: 'saveSummaries',
      });
    }
  }
}
