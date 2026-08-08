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
import { Logger, LogLevel, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';

const logger = new Logger({
  module: 'project:ImplicitEngine',
  level: LogLevel.INFO,
});

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

      // 写入 rules.md
      const rulesPath = join(projectDir, 'rules.md');
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

      // 写入 artifacts
      const artifactsPath = join(projectDir, 'artifacts.json');
      interface ArtifactEntry {
        id: string;
        projectId: string;
        kind: string;
        title: string;
        content: string;
        createdAt: string;
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
      return { contexts: 0, deliverables: 0, hasGoal: false };
    } finally {
      span.end();
    }
  }
}
