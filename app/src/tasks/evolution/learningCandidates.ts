// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 学习候选台账（2026-11-15，M1）
 *
 * 规格：`.trae/specs/learning-feedback-loop.md` §3-S3 / §5-M1。
 *
 * **候选 ≠ 行为变更**：M1 只有"发现（pending）→ 拒绝（rejected）"两态，
 * **没有** `approve`、不写任何语料、不碰提示词 ⇒ 不可能改变模型行为。
 * `approved` / `verified` 属 M2（需要 `evals --gate` 与人工批准链）—— 本文件**不预留**空状态，
 * 避免"看起来接了实际不可用"的僵尸分支（同 `SopDraftStore` 的三态纪律，按 M1 需要裁剪）。
 *
 * 存储：与 `SopDraftStore` 同构 —— 每条候选一个 JSON 文件
 * （`~/.pyapp/data/learning-candidates/learning-candidate_<id>.json`，原子写 tmp + rename），
 * 不新增数据库表（R02：不新建第二套存储）。
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { getLogger } from '@openliri/infra/monitoring';
import { handleError } from '@openliri/infra/error';
import { resolveDataSubDir } from '@openliri/infra/environment';
import type { BadcaseCategory } from './badcaseAttribution';

const logger = getLogger('tasks:evolution:learning');

/**
 * 候选待决（初始态）。
 *
 * 取值带 `lc_` 前缀：`pending` / `rejected` 是跨域通用词，直接登记会把这些词在其它模块的
 * 既有出现点一并划入状态词汇表（与 `sop_` 前缀同款教训）。
 */
export const LEARNING_CANDIDATE_PENDING = 'lc_pending';
/** 候选已拒绝（M1 唯一终态；拒绝率可观测） */
export const LEARNING_CANDIDATE_REJECTED = 'lc_rejected';

export type LearningCandidateStatus =
  | typeof LEARNING_CANDIDATE_PENDING
  | typeof LEARNING_CANDIDATE_REJECTED;

/** 候选内容（**由归因纯函数产出**，不含状态） */
export interface LearningCandidateContent {
  id: string;
  sessionId: string;
  turnNumber: number;
  category: BadcaseCategory;
  /** 该轮合成分（0..1，来源 `turn/quality`） */
  score: number;
  /** 归因证据（结构化字符串；人工复核用） */
  evidence: string[];
  /** 一句话描述（由类别 + 证据生成，便于 `/learn list` 展示） */
  summary: string;
}

/** 一条已落盘候选 */
export interface LearningCandidate extends LearningCandidateContent {
  status: LearningCandidateStatus;
  createdAt: number;
  decidedAt?: number;
  /** 人工拒绝原因（可选） */
  note?: string;
}

/** 候选统计（M1 只有 pending / rejected 两态） */
export interface LearningCandidateStats {
  total: number;
  pending: number;
  rejected: number;
  /**
   * 已拒绝占**全部候选**的比例（0..1）。
   *
   * M1 没有 `approved` 状态，若沿用 SOP 的"拒绝率 = rejected /（approved + rejected）"
   * 会恒为 1（分母只有 rejected）—— 那是指标造假，故 M1 改用"占全部候选的比例"。
   * 无候选 ⇒ `null`（不伪造 0%）。
   */
  rejectedShare: number | null;
}

/** 保存结果：新建 / 已存在（同内容幂等） */
export type LearningCandidateSaveResult = 'created' | 'existing';

const CANDIDATE_FILE_PREFIX = 'learning-candidate_';

/** 候选 id：会话 + 轮次 + 类别**确定性哈希**（同一轮同类只会有一条） */
export function computeLearningCandidateId(
  sessionId: string,
  turnNumber: number,
  category: BadcaseCategory
): string {
  return createHash('sha256')
    .update(`${sessionId}#${turnNumber}#${category}`)
    .digest('hex')
    .slice(0, 12);
}

export class LearningCandidateStore {
  /**
   * @param dir 候选目录（测试注入；缺省 `~/.pyapp/data/learning-candidates/`）
   */
  constructor(
    private readonly dir: string = resolveDataSubDir('learning-candidates')
  ) {}

  /** 候选目录（供命令展示路径） */
  getDir(): string {
    return this.dir;
  }

  private filePath(id: string): string {
    return join(this.dir, `${CANDIDATE_FILE_PREFIX}${id}.json`);
  }

  /** 列出全部候选：待决优先，其次按创建时间倒序 */
  list(): LearningCandidate[] {
    if (!existsSync(this.dir)) return [];
    let files: string[];
    try {
      files = readdirSync(this.dir).filter(
        (f) => f.startsWith(CANDIDATE_FILE_PREFIX) && f.endsWith('.json')
      );
    } catch (err) {
      logger.warn('读取学习候选目录失败', {
        dir: this.dir,
        error: String(err),
      });
      return [];
    }
    const items: LearningCandidate[] = [];
    for (const file of files) {
      const item = this.readFile(join(this.dir, file));
      if (item) items.push(item);
    }
    items.sort((a, b) => {
      const pa = a.status === LEARNING_CANDIDATE_PENDING ? 0 : 1;
      const pb = b.status === LEARNING_CANDIDATE_PENDING ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return b.createdAt - a.createdAt;
    });
    return items;
  }

  /** 按 id 前缀查找（返回全部匹配；命令侧判定歧义） */
  find(idOrPrefix: string): LearningCandidate[] {
    const key = idOrPrefix.trim();
    if (!key) return [];
    return this.list().filter((c) => c.id === key || c.id.startsWith(key));
  }

  /** 保存候选（**幂等**）：同 id 已存在（无论状态）⇒ `existing`，不改写已决状态 */
  save(
    content: LearningCandidateContent,
    now: number = Date.now()
  ): LearningCandidateSaveResult {
    const path = this.filePath(content.id);
    if (existsSync(path)) return 'existing';
    mkdirSync(this.dir, { recursive: true });
    this.writeFile(path, {
      ...content,
      status: LEARNING_CANDIDATE_PENDING,
      createdAt: now,
    });
    return 'created';
  }

  /**
   * 拒绝候选（**M1 唯一的决定动作**）。
   *
   * @returns 更新后的候选；不存在 ⇒ `null`；已是终态 ⇒ 原样返回（不改写）
   */
  reject(candidate: LearningCandidate, note?: string): LearningCandidate {
    if (candidate.status !== LEARNING_CANDIDATE_PENDING) return candidate;
    const next: LearningCandidate = {
      ...candidate,
      status: LEARNING_CANDIDATE_REJECTED,
      decidedAt: Date.now(),
      ...(note && note.trim() ? { note: note.trim() } : {}),
    };
    this.writeFile(this.filePath(candidate.id), next);
    return next;
  }

  private writeFile(path: string, item: LearningCandidate): void {
    const tmp = `${path}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(item, null, 2), 'utf-8');
      renameSync(tmp, path);
    } catch (err) {
      void handleError(err, {
        module: 'tasks:evolution:learning',
        action: 'writeCandidate',
        context: { id: item.id },
      });
    }
  }

  private readFile(path: string): LearningCandidate | null {
    try {
      const parsed = JSON.parse(
        readFileSync(path, 'utf-8')
      ) as LearningCandidate;
      if (!parsed || typeof parsed.id !== 'string') return null;
      return parsed;
    } catch (err) {
      // @ignore-catch — 单文件损坏 ⇒ 跳过（不伪造候选）
      logger.warn('学习候选文件解析失败，已跳过', {
        file: path,
        error: String(err),
      });
      return null;
    }
  }
}

/** 统计（纯函数；无候选 ⇒ `rejectedShare` 为 `null`，不伪造 0） */
export function computeLearningCandidateStats(
  items: readonly LearningCandidate[]
): LearningCandidateStats {
  let pending = 0;
  let rejected = 0;
  for (const item of items) {
    if (item.status === LEARNING_CANDIDATE_PENDING) pending++;
    else if (item.status === LEARNING_CANDIDATE_REJECTED) rejected++;
  }
  return {
    total: items.length,
    pending,
    rejected,
    rejectedShare: items.length > 0 ? rejected / items.length : null,
  };
}
