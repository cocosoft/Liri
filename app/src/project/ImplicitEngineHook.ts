/**
 * 隐性引擎钩子
 *
 * 规则驱动的 post-process：分析 AI/用户消息文本，检测 Plan/Do/Check/Act 意图，
 * 自动写入 rules.md（Plan 类）或 artifacts（Do 类）。
 *
 * 触发策略：仅对"有产出意图"的消息触发（规则匹配命中），普通闲聊跳过。
 */

import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolveDataDir } from '@modules/core/paths';
import { randomUUID } from 'crypto';
import type { ProjectContextType } from '@modules/workspace/types';
import { createProjectHistoryStore } from './ProjectHistoryStore';
import {
  createRequirementTracker,
  type RequirementType,
} from './RequirementTracker';
import { getLogger, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';
import { ProjectItemStore } from '../workspace/ProjectItemStore';

const logger = getLogger('project:ImplicitEngine');

/** 意图分类 */
export type ImplicitIntent = 'plan' | 'do' | 'check' | 'act' | 'none';

/** 规则匹配结果 */
export interface IntentMatch {
  intent: ImplicitIntent;
  /** 提取出的上下文类型 */
  contextType?: ProjectContextType;
  /** 提取出的内容 */
  content: string;
  /** 置信度 0-1 */
  confidence: number;
}

// ──── Plan 检测规则 ────
const PLAN_PATTERNS: Array<{ regex: RegExp; type: ProjectContextType }> = [
  { regex: /目标[是为：:]\s*(.+)/, type: 'goal' },
  { regex: /项目目标[是为：:]\s*(.+)/, type: 'goal' },
  { regex: /核心目标[是为：:]\s*(.+)/, type: 'goal' },
  { regex: /范围[是为：:]\s*(.+)/, type: 'scope' },
  { regex: /不[包括含做]|只做|仅限[于]?(\S+)/, type: 'scope' },
  { regex: /约束[是为：:]\s*(.+)/, type: 'constraint' },
  { regex: /限制[是为：:]\s*(.+)/, type: 'constraint' },
  { regex: /需求[是为：:]\s*(.+)/, type: 'requirement' },
  { regex: /知识[是为：:]\s*(.+)/, type: 'knowledge' },
];

// ──── Do 检测规则 ────
const DO_PATTERNS = [
  /生成[了]?\s*(.+)/,
  /创建[了]?\s*(.+)/,
  /产出[了：:]\s*(.+)/,
  /交付[了：:]\s*(.+)/,
  /完成[了：:]\s*(.+)/,
  /已[经]?\s*实现[了：:]\s*(.+)/,
];

// ──── Check 检测规则 ────
const CHECK_PATTERNS = [/检查|验证|对照|审核|比对|核实/];

// ──── Act 检测规则 ────
const ACT_PATTERNS = [/调整|修改|改进|优化|纠正|修复/];

export class ImplicitEngineHook {
  /**
   * 分析消息文本，检测意图并提取内容
   */
  static analyze(text: string): IntentMatch[] {
    const matches: IntentMatch[] = [];

    // Plan 检测
    for (const { regex, type } of PLAN_PATTERNS) {
      const m = text.match(regex);
      if (m?.[1]) {
        const content = m[1].trim().slice(0, 200);
        // 方案七 7b：跳过明显误提取片段（如从"附件:【…】"误判出的"附件目录"）
        if (content.length >= 2 && !/^附件|^【/.test(content)) {
          matches.push({
            intent: 'plan',
            contextType: type,
            content,
            confidence: 0.7,
          });
        }
      }
    }

    // Do 检测
    for (const pattern of DO_PATTERNS) {
      const m = text.match(pattern);
      if (m?.[1]) {
        const content = m[1].trim().slice(0, 200);
        if (content.length >= 3) {
          matches.push({ intent: 'do', content, confidence: 0.6 });
        }
        break; // 只取第一个匹配
      }
    }

    // Check 检测
    for (const pattern of CHECK_PATTERNS) {
      if (pattern.test(text)) {
        matches.push({
          intent: 'check',
          content: text.slice(0, 100),
          confidence: 0.5,
        });
        break;
      }
    }

    // Act 检测
    for (const pattern of ACT_PATTERNS) {
      if (pattern.test(text)) {
        matches.push({
          intent: 'act',
          content: text.slice(0, 100),
          confidence: 0.4,
        });
        break;
      }
    }

    return matches;
  }

  /**
   * 判断是否有产出意图（非闲聊）
   */
  static hasIntent(text: string): boolean {
    return this.analyze(text).length > 0;
  }

  /**
   * 处理消息：分析意图并返回需要写入的数据
   * 由调用方负责 HTTP 写入（避免模块耦合 HTTP）
   */
  static process(text: string): {
    contexts: Array<{ type: ProjectContextType; content: string }>;
    deliverables: string[];
  } {
    const matches = this.analyze(text);
    const contexts: Array<{ type: ProjectContextType; content: string }> = [];
    const deliverables: string[] = [];

    for (const match of matches) {
      if (match.intent === 'plan' && match.contextType) {
        contexts.push({ type: match.contextType, content: match.content });
      }
      if (match.intent === 'do') {
        // 方案七 7a：产出识别锚定真实文件路径/文件名（含交付类扩展名），
        // 丢弃纯文本碎片（如"**文件**：`E:\...pptx`（363"的截断片段）
        const fileMatch = match.content.match(
          /([^\s`（）()]*\.(?:docx|pptx|pdf|html|xlsx|md|png|jpe?g|svg))/i
        );
        const del = fileMatch?.[1]?.trim();
        if (del && del.length >= 3) {
          deliverables.push(del);
        }
      }
    }

    return { contexts, deliverables };
  }

  /**
   * 分析消息并持久化到 rules.md 和 artifacts 文件
   *
   * @param projectId 项目 ID（worktree ID）
   * @param text 消息文本
   * @returns 写入的 contexts/deliverables 数量，以及是否检测到 goal（可用于升级为完整 PDCA）
   */
  static async persist(
    projectId: string,
    text: string,
    projectsDir?: string,
    sessionId?: string
  ): Promise<{
    contexts: number;
    deliverables: number;
    hasGoal: boolean;
    goalSummary?: string;
    /** D3/M5：本次注册的需求（goal/requirement 上下文）数 */
    registeredRequirements: number;
  }> {
    const otel = getOTelTracing();
    const span = otel.startSpan('ImplicitEngineHook.persist');
    span.setAttribute('projectId', projectId);

    try {
      const result = {
        contexts: 0,
        deliverables: 0,
        hasGoal: false,
        goalSummary: undefined as string | undefined,
        registeredRequirements: 0,
      };
      const { contexts, deliverables } = this.process(text);
      if (contexts.length === 0 && deliverables.length === 0) {
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      }

      result.hasGoal = contexts.some((c) => c.type === 'goal');
      const goalCtx = contexts.find((c) => c.type === 'goal');
      if (goalCtx) {
        result.goalSummary = goalCtx.content
          .replace(/^goal\s*/i, '')
          .slice(0, 40);
      }

      const root = projectsDir || join(resolveDataDir(), 'projects');
      const projectDir = join(root, projectId);

      if (!existsSync(projectDir)) {
        mkdirSync(projectDir, { recursive: true });
      }

      // D3/M5：需求追踪 — goal/requirement 上下文注册 requirementId（同内容去重复用）
      const requirementTracker = createRequirementTracker(projectId, root);
      const requirementIds: string[] = [];
      for (const ctx of contexts) {
        if (ctx.type === 'goal' || ctx.type === 'requirement') {
          try {
            // BUG-9 修复：仅"本次新注册"才计数（原实现去重命中仍无条件自增 → 计数虚高）
            const isNew = !requirementTracker.isRegistered(ctx.content);
            const req = requirementTracker.register({
              type: ctx.type as RequirementType,
              content: ctx.content,
              sessionId,
            });
            if (!requirementIds.includes(req.id)) requirementIds.push(req.id);
            if (isNew) result.registeredRequirements++;
          } catch (err) {
            void handleError(err, {
              module: 'project:ImplicitEngine',
              action: 'registerRequirement',
            });
          }
        }
      }
      const primaryRequirementId = requirementIds[0];

      // 写入 rules.md（迁移前）或 items.db（迁移后）
      // BUG-5 修复：S2 迁移（rules.md → items.db，文件改名 .bak）后原逻辑仍直写
      // rules.md → 重建文件 → needsMigration() 再次为 true → 重复迁移产生脏数据 + 数据分叉。
      // 改为：legacy 文件存在（未迁移）写 rules.md；不存在（已迁移或全新项目）写 items.db。
      const rulesPath = join(projectDir, 'rules.md');
      const migrated = !existsSync(rulesPath);

      if (migrated) {
        const itemStore = new ProjectItemStore(projectId, resolveDataDir());
        await itemStore.initialize();
        const existingItems = await itemStore.list('context');
        for (const ctx of contexts) {
          const dup = existingItems.some(
            (i) => i.type === ctx.type && i.content === ctx.content
          );
          if (!dup) {
            await itemStore.upsert({
              id: `implicit_ctx_${Date.now()}_${result.contexts}`,
              projectId,
              kind: 'context',
              type: ctx.type,
              title: ctx.content,
              content: ctx.content,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
            result.contexts++;
          }
        }
      } else {
        let existingLines: string[] = [];
        if (existsSync(rulesPath)) {
          existingLines = readFileSync(rulesPath, 'utf-8').split('\n');
        }
        for (const ctx of contexts) {
          const marker = `### [${ctx.type}] ${ctx.content}`;
          if (!existingLines.some((l) => l.trim() === marker)) {
            existingLines.push(marker);
            result.contexts++;
          }
        }
        if (result.contexts > 0) {
          writeFileSync(rulesPath, existingLines.join('\n') + '\n', 'utf-8');
        }
      }

      // 写入 artifacts（迁移前 artifacts.json，迁移后 items.db）
      const artifactsPath = join(projectDir, 'artifacts.json');
      if (migrated) {
        const itemStore = new ProjectItemStore(projectId, resolveDataDir());
        await itemStore.initialize();
        const existingItems = await itemStore.list('artifact');
        for (const del of deliverables) {
          const dup = existingItems.some((a) => a.title === del.slice(0, 80));
          if (!dup) {
            await itemStore.upsert({
              id: randomUUID(),
              projectId,
              kind: 'artifact',
              type: 'artifact',
              title: del.slice(0, 80),
              content: del,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
            result.deliverables++;
          }
        }
      } else {
        interface ArtifactEntry {
          id: string;
          projectId: string;
          kind: string;
          title: string;
          content: string;
          createdAt: string;
          /** D3/M5：关联的需求 ID（产物证据 → 需求映射） */
          requirementId?: string;
        }
        let artifacts: ArtifactEntry[] = [];
        if (existsSync(artifactsPath)) {
          try {
            artifacts = JSON.parse(readFileSync(artifactsPath, 'utf-8'));
          } catch {
            artifacts = [];
          }
        }

        for (const del of deliverables) {
          const exists = artifacts.some((a) => a.title === del.slice(0, 80));
          if (!exists) {
            artifacts.push({
              id: randomUUID(),
              projectId,
              kind: 'output',
              title: del.slice(0, 80),
              content: del,
              createdAt: new Date().toISOString(),
              requirementId: primaryRequirementId,
            });
            result.deliverables++;
          }
        }

        if (result.deliverables > 0) {
          writeFileSync(
            artifactsPath,
            JSON.stringify(artifacts, null, 2),
            'utf-8'
          );
        }
      }

      // 记录讨论历史
      if (sessionId && (result.contexts > 0 || result.deliverables > 0)) {
        const history = createProjectHistoryStore(projectId);
        for (const ctx of contexts) {
          history.append({
            sessionId,
            type: 'context_change',
            summary: `资料更新 [${ctx.type}]: ${ctx.content.slice(0, 60)}`,
            detail: ctx.content,
            internal: true,
          });
        }
        for (const del of deliverables) {
          history.append({
            sessionId,
            type: 'decision',
            summary: `产出: ${del.slice(0, 60)}`,
            detail: del,
            internal: true,
          });
        }
      }

      logger.info('隐性引擎持久化完成', {
        projectId,
        contexts: result.contexts,
        deliverables: result.deliverables,
        hasGoal: result.hasGoal,
      });
      span.setAttribute('contexts', result.contexts);
      span.setAttribute('deliverables', result.deliverables);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (e) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
      await handleError(e, {
        module: 'project:ImplicitEngine',
        action: 'persist',
      });
      return {
        contexts: 0,
        deliverables: 0,
        hasGoal: false,
        registeredRequirements: 0,
      };
    } finally {
      span.end();
    }
  }
}
