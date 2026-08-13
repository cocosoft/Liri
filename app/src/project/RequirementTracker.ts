// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * RequirementTracker — 需求追踪（D3/M5，StageOrchestrator §4.7 需求追踪 ID）
 *
 * requirementId 从 ImplicitEngineHook 命中 goal/requirement 上下文时生成，
 * 存储于项目目录 requirements.json（与 rules.md / artifacts.json 同层）。
 * 覆盖检查：每项需求 → 证据（artifacts.json 中 requirementId 标签匹配，
 * 或 title/content 含需求 8 字符片段——证据映射，非状态判断，与 CS02 不冲突）。
 *
 * 说明：四阶段产物（PRD→设计→实现→测试）依赖 StageOrchestrator 阶段链（未建），
 * 本模块先落地"需求 ID 生成 + 需求→产物证据映射"基础，阶段链就绪后直接消费。
 */

import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { resolveDataSubDir } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('project:requirementTracker');

export type RequirementType =
  | 'goal'
  | 'requirement'
  | 'scope'
  | 'constraint'
  | 'knowledge';

export interface Requirement {
  id: string;
  type: RequirementType;
  content: string;
  createdAt: string;
  sessionId?: string;
}

export interface RequirementCoverage {
  requirement: Requirement;
  /** 是否有证据（实现/测试产物） */
  covered: boolean;
  /** 证据 artifact 标题列表 */
  evidence: string[];
}

const REQUIREMENTS_FILE = 'requirements.json';

/** 确定性 ID：内容 sha1 前 12 位 → 稳定跨重启 + 内容去重友好 */
function requirementIdOf(content: string): string {
  return `req_${createHash('sha1').update(content).digest('hex').slice(0, 12)}`;
}

/** 证据匹配：需求内容片段（8 字符窗口）出现在 artifact 文本中 */
function hasEvidenceFragment(
  reqContent: string,
  artifactText: string
): boolean {
  const content = reqContent.trim();
  if (!content) return false;
  if (artifactText.includes(content)) return true;
  for (let i = 0; i <= content.length - 8; i++) {
    if (artifactText.includes(content.slice(i, i + 8))) return true;
  }
  return false;
}

export class RequirementTracker {
  constructor(
    private projectId: string,
    private projectsRoot?: string
  ) {}

  private get dir(): string {
    const base = this.projectsRoot || resolveDataSubDir('projects');
    return join(base, this.projectId);
  }

  private get filePath(): string {
    return join(this.dir, REQUIREMENTS_FILE);
  }

  private ensureDir(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  private load(): Requirement[] {
    if (!existsSync(this.filePath)) return [];
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf-8')) as Requirement[];
    } catch (e) {
      void handleError(e, {
        module: 'project:requirementTracker',
        action: 'load',
      });
      return [];
    }
  }

  private save(reqs: Requirement[]): void {
    this.ensureDir();
    writeFileSync(this.filePath, JSON.stringify(reqs, null, 2), 'utf-8');
  }

  /**
   * 注册需求（D3/M5）：内容去重——同内容复用同一 requirementId
   * @throws 内容为空时抛错（调用方已过滤，正常不会触发）
   */
  register(input: {
    type: RequirementType;
    content: string;
    sessionId?: string;
  }): Requirement {
    const content = input.content.trim();
    if (!content) {
      throw new Error('Requirement content is empty');
    }
    const id = requirementIdOf(content);
    const existing = this.load();
    const found = existing.find((r) => r.id === id);
    if (found) return found;
    const req: Requirement = {
      id,
      type: input.type,
      content,
      createdAt: new Date().toISOString(),
      sessionId: input.sessionId,
    };
    existing.push(req);
    this.save(existing);
    logger.info('需求已注册', {
      projectId: this.projectId,
      requirementId: id,
      type: input.type,
      contentPreview: content.slice(0, 60),
    });
    return req;
  }

  /** 列出全部已注册需求 */
  list(): Requirement[] {
    return this.load();
  }

  /**
   * 覆盖检查（D3/M5）：每项需求 → 证据映射
   * 证据 = artifacts.json 中 requirementId 标签匹配，或 title/content 含需求片段
   */
  checkCoverage(): RequirementCoverage[] {
    const reqs = this.load();
    const artifacts = this.loadArtifacts();
    return reqs.map((req) => {
      const evidence = artifacts
        .filter(
          (a) =>
            a.requirementId === req.id ||
            hasEvidenceFragment(req.content, `${a.title} ${a.content}`)
        )
        .map((a) => a.title);
      return {
        requirement: req,
        covered: evidence.length > 0,
        evidence,
      };
    });
  }

  private loadArtifacts(): Array<{
    title: string;
    content: string;
    requirementId?: string;
  }> {
    const p = join(this.dir, 'artifacts.json');
    if (!existsSync(p)) return [];
    try {
      return JSON.parse(readFileSync(p, 'utf-8')) as Array<{
        title: string;
        content: string;
        requirementId?: string;
      }>;
    } catch {
      return [];
    }
  }
}

/** 便捷工厂 */
export function createRequirementTracker(
  projectId: string,
  projectsRoot?: string
): RequirementTracker {
  return new RequirementTracker(projectId, projectsRoot);
}
