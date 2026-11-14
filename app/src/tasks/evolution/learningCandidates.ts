// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 学习候选台账（2026-11-15，M1 + M2）
 *
 * 规格：`.trae/specs/learning-feedback-loop.md` §3-S3 / §5-M1 / §5-M2。
 *
 * **候选 ≠ 行为变更**：台账本身只写本地 JSON，不改提示词、不装技能。
 * - M1：`lc_pending` → `lc_rejected`（只有发现与拒绝）；
 * - M2：`lc_pending` → `lc_verified`（**结构化校验**，不跑模型）→ `lc_approved`
 *   （导出为**语料种子**行，`expectation` 留空待人工补）；`lc_approved` 可 `revoke` 回 `lc_rejected`。
 *   `--gate` 卡口与语料合入**不在本文件**（需模型 + 长耗时，人工执行，见 spec §5-M3）。
 *
 * 存储：与 `SopDraftStore` 同构 —— 每条候选一个 JSON 文件
 * （`~/.pyapp/data/learning-candidates/learning-candidate_<id>.json`，原子写 tmp + rename），
 * 批准产物追加到同目录 `approved-cases.jsonl`（一行一条，`expectation` 由人工补齐后再合入 eval），
 * 不新增数据库表（R02：不新建第二套存储）。
 */

import {
  appendFileSync,
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
import { MS_PER_DAY } from '@openliri/infra/constants';
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
/** 候选已结构化校验（M2：可被批准的前置态；只校验可导出为语料种子，不跑模型） */
export const LEARNING_CANDIDATE_VERIFIED = 'lc_verified';
/** 候选已批准（M2：已导出为语料**种子**，等待人工补期望后合入 evals） */
export const LEARNING_CANDIDATE_APPROVED = 'lc_approved';
/** 候选已拒绝（终态；`revoke` 也落此态并记 note） */
export const LEARNING_CANDIDATE_REJECTED = 'lc_rejected';

export type LearningCandidateStatus =
  | typeof LEARNING_CANDIDATE_PENDING
  | typeof LEARNING_CANDIDATE_VERIFIED
  | typeof LEARNING_CANDIDATE_APPROVED
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
  /**
   * 该轮用户输入（**若可取**：`user/message` 事件与该轮 `turn/start` 的结构化配对）。
   *
   * 仅用于导出语料种子；取不到就不写（不猜、不补默认值）。
   */
  input?: string;
}

/** 结构化校验记录（M2：`lc_pending → lc_verified` 的唯一依据） */
export interface LearningCandidateGate {
  /** 校验时间 */
  checkedAt: number;
  /**
   * 校验种类：M2 只有 `structural`（必需字段齐全 + id 可复算 + 证据非空）。
   * 不跑模型、不跑 evals —— 那是人工执行的 M3 卡口。
   */
  kind: 'structural';
}

/** 一条已落盘候选 */
export interface LearningCandidate extends LearningCandidateContent {
  status: LearningCandidateStatus;
  createdAt: number;
  decidedAt?: number;
  /** 人工拒绝原因（可选；`revoke` 会写 `已撤销（原因）`） */
  note?: string;
  /** 结构化校验记录（`verified` 起有值） */
  gate?: LearningCandidateGate;
  /** 批准有效期（毫秒时间戳；`approved` 起有值，默认 now + 30 天） */
  expiresAt?: number;
}

/** 语料种子行（`approved-cases.jsonl` 的一行；`expectation` 由人工补） */
export interface LearningApprovedCase {
  id: string;
  sessionId: string;
  turnNumber: number;
  category: BadcaseCategory;
  score: number;
  evidence: string[];
  /** 该轮用户输入（取不到为 `null`） */
  input: string | null;
  /** 期望答案：**M2 不自动生成**，人工合入 eval 语料时补齐 */
  expectation: null;
  approvedAt: number;
  /** 撤销时间（撤销后由本字段标记，不从文件删除） */
  revokedAt?: number;
}

/** 候选统计（M1 两态 → M2 四态） */
export interface LearningCandidateStats {
  total: number;
  pending: number;
  verified: number;
  approved: number;
  rejected: number;
  /**
   * 已拒绝占**全部候选**的比例（0..1）。
   *
   * 若沿用 SOP 的"拒绝率 = rejected /（approved + rejected）"，在无批准时口径会失真；
   * 本台账统一用"占全部候选"，无候选 ⇒ `null`（不伪造 0%）。
   */
  rejectedShare: number | null;
}

/** 保存结果：新建 / 已存在（同内容幂等） */
export type LearningCandidateSaveResult = 'created' | 'existing';

const CANDIDATE_FILE_PREFIX = 'learning-candidate_';

/** 批准有效期（天；M2 默认值，spec §8-3 裁定） */
export const LEARNING_APPROVAL_DAYS = 30;

/** 语料种子文件名（与候选同目录） */
export const LEARNING_APPROVED_CASES_FILE = 'approved-cases.jsonl';

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

  /**
   * 结构化校验（M2）：`lc_pending → lc_verified`。
   *
   * **只做结构与一致性检查**（id 可复算、分数/轮次/证据齐全），不跑模型、不跑 evals。
   * @returns 更新后的候选；非 `pending` 或校验不通过 ⇒ `null`（不改写）
   */
  markVerified(
    candidate: LearningCandidate,
    now: number = Date.now()
  ): LearningCandidate | null {
    if (candidate.status !== LEARNING_CANDIDATE_PENDING) return null;
    if (!isStructurallyVerifiable(candidate)) return null;
    const next: LearningCandidate = {
      ...candidate,
      status: LEARNING_CANDIDATE_VERIFIED,
      decidedAt: now,
      gate: { checkedAt: now, kind: 'structural' },
    };
    this.writeFile(this.filePath(candidate.id), next);
    return next;
  }

  /**
   * 批准（M2）：`lc_verified → lc_approved`，并把语料**种子**追加到 `approved-cases.jsonl`。
   *
   * 顺序：先写种子行（失败则不翻状态），再落候选状态 ⇒ 不会出现"已批准但没有种子"。
   * `expectation` 恒为 `null`：期望答案必须人工补，本方法不生成答案（CS04）。
   *
   * @returns 更新后的候选；非 `verified` 或种子写失败 ⇒ `null`
   */
  approve(
    candidate: LearningCandidate,
    now: number = Date.now()
  ): LearningCandidate | null {
    if (candidate.status !== LEARNING_CANDIDATE_VERIFIED) return null;
    const expiresAt = now + LEARNING_APPROVAL_DAYS * MS_PER_DAY;
    const seed: LearningApprovedCase = {
      id: candidate.id,
      sessionId: candidate.sessionId,
      turnNumber: candidate.turnNumber,
      category: candidate.category,
      score: candidate.score,
      evidence: [...candidate.evidence],
      input: candidate.input ?? null,
      expectation: null,
      approvedAt: now,
    };
    if (!this.appendApprovedCase(seed)) return null;
    const next: LearningCandidate = {
      ...candidate,
      status: LEARNING_CANDIDATE_APPROVED,
      decidedAt: now,
      expiresAt,
    };
    this.writeFile(this.filePath(candidate.id), next);
    return next;
  }

  /**
   * 撤销批准（M2）：`lc_approved → lc_rejected`，并在种子行写 `revokedAt`（**不删行**，保留审计）。
   *
   * @param note 撤销原因（必填，命令层校验；写入 `note`）
   * @returns 更新后的候选；非 `approved` ⇒ 原样返回（不改写）
   */
  revoke(
    candidate: LearningCandidate,
    note: string,
    now: number = Date.now()
  ): LearningCandidate {
    if (candidate.status !== LEARNING_CANDIDATE_APPROVED) return candidate;
    this.markApprovedCaseRevoked(candidate.id, now);
    const reason = note.trim();
    const next: LearningCandidate = {
      ...candidate,
      status: LEARNING_CANDIDATE_REJECTED,
      decidedAt: now,
      note: reason ? `已撤销（${reason}）` : '已撤销',
    };
    this.writeFile(this.filePath(candidate.id), next);
    return next;
  }

  /** 语料种子文件路径（供 `/learn export` 展示） */
  getApprovedCasesPath(): string {
    return join(this.dir, LEARNING_APPROVED_CASES_FILE);
  }

  /** 读取语料种子（单行损坏 ⇒ 跳过；文件不存在 ⇒ 空数组） */
  listApprovedCases(): LearningApprovedCase[] {
    const path = this.getApprovedCasesPath();
    if (!existsSync(path)) return [];
    let text: string;
    try {
      text = readFileSync(path, 'utf-8');
    } catch (err) {
      logger.warn('读取语料种子失败', { path, error: String(err) });
      return [];
    }
    const cases: LearningApprovedCase[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as LearningApprovedCase;
        if (parsed && typeof parsed.id === 'string') cases.push(parsed);
      } catch (err) {
        // @ignore-catch — 单行损坏 ⇒ 跳过（不伪造种子）
        logger.warn('语料种子行解析失败，已跳过', { path, error: String(err) });
      }
    }
    return cases;
  }

  /** 追加一条种子行（失败 ⇒ `false`，调用方据此不翻状态） */
  private appendApprovedCase(seed: LearningApprovedCase): boolean {
    try {
      mkdirSync(this.dir, { recursive: true });
      appendFileSync(
        this.getApprovedCasesPath(),
        `${JSON.stringify(seed)}\n`,
        'utf-8'
      );
      return true;
    } catch (err) {
      void handleError(err, {
        module: 'tasks:evolution:learning',
        action: 'appendApprovedCase',
        context: { id: seed.id },
      });
      return false;
    }
  }

  /** 给同 id 的种子行补 `revokedAt`（整文件原子重写；损坏行原样保留） */
  private markApprovedCaseRevoked(id: string, now: number): void {
    const path = this.getApprovedCasesPath();
    if (!existsSync(path)) return;
    let text: string;
    try {
      text = readFileSync(path, 'utf-8');
    } catch (err) {
      logger.warn('读取语料种子失败（撤销标记未写入）', {
        path,
        error: String(err),
      });
      return;
    }
    const lines = text.split('\n').filter((line) => line.trim());
    const rewritten = lines.map((line) => {
      try {
        const parsed = JSON.parse(line) as LearningApprovedCase;
        if (parsed.id !== id) return line;
        return JSON.stringify({ ...parsed, revokedAt: now });
      } catch {
        // @ignore-catch — 损坏行原样保留（不在撤销动作里顺手清洗数据）
        return line;
      }
    });
    this.writeText(path, `${rewritten.join('\n')}\n`);
  }

  private writeText(path: string, text: string): void {
    const tmp = `${path}.tmp`;
    try {
      writeFileSync(tmp, text, 'utf-8');
      renameSync(tmp, path);
    } catch (err) {
      void handleError(err, {
        module: 'tasks:evolution:learning',
        action: 'writeApprovedCases',
        context: { path },
      });
    }
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
  let verified = 0;
  let approved = 0;
  let rejected = 0;
  for (const item of items) {
    if (item.status === LEARNING_CANDIDATE_PENDING) pending++;
    else if (item.status === LEARNING_CANDIDATE_VERIFIED) verified++;
    else if (item.status === LEARNING_CANDIDATE_APPROVED) approved++;
    else if (item.status === LEARNING_CANDIDATE_REJECTED) rejected++;
  }
  return {
    total: items.length,
    pending,
    verified,
    approved,
    rejected,
    rejectedShare: items.length > 0 ? rejected / items.length : null,
  };
}

/**
 * 结构化可校验性（M2，纯函数）：字段齐全、id 可复算、分数在 0..1、证据非空。
 *
 * 只用**结构化字段**判定（CS02），不看 `summary` 文案。任一不满足 ⇒ 不可进入 `verified`。
 */
export function isStructurallyVerifiable(
  candidate: LearningCandidate
): boolean {
  if (!candidate.sessionId || !candidate.category) return false;
  if (!Number.isInteger(candidate.turnNumber) || candidate.turnNumber <= 0)
    return false;
  if (!Number.isFinite(candidate.score)) return false;
  if (candidate.score < 0 || candidate.score > 1) return false;
  if (!Array.isArray(candidate.evidence) || candidate.evidence.length === 0)
    return false;
  return (
    candidate.id ===
    computeLearningCandidateId(
      candidate.sessionId,
      candidate.turnNumber,
      candidate.category
    )
  );
}
