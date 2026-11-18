// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * SOP 草案存储（D10，2026-11-14）
 *
 * **草案 ≠ 技能**：草案落在 `~/.pyapp/data/sop-drafts/`（数据层，不参与技能加载），
 * 只有 {@link SopDraftStore.installSkill}（由人工执行的 `/sop approve` 调用）才写入
 * `~/.pyapp/skills/<name>/SKILL.md` —— 即"注册"动作**只发生在人工确认之后**。
 *
 * 状态（三态，终态不可改写）：
 *   sop_pending --approve--> sop_approved
 *   sop_pending --reject ---> sop_rejected
 * 拒绝率 = rejected /（approved + rejected），`sop_pending` 不计入分母（未决不是"拒绝"）。
 *
 * 存储：每条草案一个 JSON 文件（`sop-draft_<id>.json`），原子写（tmp + rename）；
 * 与 `TaskOrchestrator.savePlan` 同风格 —— 不新增数据库表（R02：不新建第二套存储）。
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { getLogger } from '@openliri/infra/monitoring';
import { handleError } from '@openliri/infra/error';
import {
  resolveDataSubDir,
  resolveUserSkillsDir,
} from '@openliri/infra/environment';
import type { SopDraftContent } from './sopDistill';

const logger = getLogger('tasks:evolution:sop');

/**
 * 草案待决（初始态）。
 *
 * 取值带 `sop_` 前缀：`pending/approved/rejected` 是跨域通用词，直接登记会把这些词
 * 在其它模块的既有出现点一并划入状态词汇表（与 `effect_` / `step_` 前缀同款教训）。
 */
export const SOP_DRAFT_PENDING = 'sop_pending';
/** 草案已批准（终态：已写入技能目录） */
export const SOP_DRAFT_APPROVED = 'sop_approved';
/** 草案已拒绝（终态） */
export const SOP_DRAFT_REJECTED = 'sop_rejected';

export type SopDraftStatus =
  | typeof SOP_DRAFT_PENDING
  | typeof SOP_DRAFT_APPROVED
  | typeof SOP_DRAFT_REJECTED;

/** 一条已落盘草案 */
export interface SopDraft extends SopDraftContent {
  status: SopDraftStatus;
  createdAt: number;
  decidedAt?: number;
  /** 人工决定时的备注（拒绝原因等，可选） */
  note?: string;
}

/** 草案统计（拒绝率可观测的机器可读形态） */
export interface SopDraftStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  /** rejected /（approved + rejected）；无已决草案 ⇒ `null`（不伪造 0%） */
  rejectedRate: number | null;
}

/** 保存结果：新建 / 已存在（同内容幂等） */
export type SopDraftSaveResult = 'created' | 'existing';

/** 技能名（**由内容哈希派生**，不取用户/模型输入 ⇒ 天然安全） */
export function sopSkillName(id: string): string {
  return `sop-${id}`;
}

const DRAFT_FILE_PREFIX = 'sop-draft_';

export class SopDraftStore {
  /**
   * @param dir 草案目录（测试注入；缺省 `~/.pyapp/data/sop-drafts/`）
   * @param skillsDir 用户技能目录（测试注入；缺省 `~/.pyapp/skills/`）
   */
  constructor(
    private readonly dir: string = resolveDataSubDir('sop-drafts'),
    private readonly skillsDir: string = resolveUserSkillsDir()
  ) {}

  /** 草案目录（供命令展示路径） */
  getDir(): string {
    return this.dir;
  }

  private filePath(id: string): string {
    return join(this.dir, `${DRAFT_FILE_PREFIX}${id}.json`);
  }

  /** 列出全部草案：待决优先，其次按创建时间倒序 */
  list(): SopDraft[] {
    if (!existsSync(this.dir)) return [];
    let files: string[];
    try {
      files = readdirSync(this.dir).filter(
        (f) => f.startsWith(DRAFT_FILE_PREFIX) && f.endsWith('.json')
      );
    } catch (err) {
      logger.warn('读取 SOP 草案目录失败', {
        dir: this.dir,
        error: String(err),
      });
      return [];
    }
    const drafts: SopDraft[] = [];
    for (const file of files) {
      const draft = this.readFile(join(this.dir, file));
      if (draft) drafts.push(draft);
    }
    drafts.sort((a, b) => {
      const pa = a.status === SOP_DRAFT_PENDING ? 0 : 1;
      const pb = b.status === SOP_DRAFT_PENDING ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return b.createdAt - a.createdAt;
    });
    return drafts;
  }

  /** 按 id 前缀查找（返回全部匹配；命令侧判定歧义） */
  find(idOrPrefix: string): SopDraft[] {
    const key = idOrPrefix.trim();
    if (!key) return [];
    return this.list().filter((d) => d.id === key || d.id.startsWith(key));
  }

  /**
   * 保存草案（**幂等**）：同 id 已存在（无论状态）⇒ `existing`，不改写已决状态。
   */
  save(content: SopDraftContent, now: number = Date.now()): SopDraftSaveResult {
    const path = this.filePath(content.id);
    if (existsSync(path)) return 'existing';
    mkdirSync(this.dir, { recursive: true });
    const draft: SopDraft = {
      ...content,
      status: SOP_DRAFT_PENDING,
      createdAt: now,
    };
    this.writeFile(path, draft);
    return 'created';
  }

  /**
   * 人工决定（approve / reject）。
   *
   * @returns 更新后的草案；草案不存在 ⇒ `null`。已是终态 ⇒ 原样返回（不改写）。
   */
  decide(
    draft: SopDraft,
    status: typeof SOP_DRAFT_APPROVED | typeof SOP_DRAFT_REJECTED,
    note?: string
  ): SopDraft {
    if (draft.status !== SOP_DRAFT_PENDING) return draft;
    const next: SopDraft = {
      ...draft,
      status,
      decidedAt: Date.now(),
      ...(note && note.trim() ? { note: note.trim() } : {}),
    };
    this.writeFile(this.filePath(draft.id), next);
    return next;
  }

  /**
   * 写入用户技能（**唯一的注册动作**，仅由人工批准触发）。
   *
   * @returns SKILL.md 路径；目标目录已存在 ⇒ `null`（不覆盖用户已有技能）
   */
  installSkill(draft: SopDraft): string | null {
    const name = sopSkillName(draft.id);
    if (!/^[a-z0-9-]+$/.test(name)) {
      throw new Error(`非法技能名：${name}`);
    }
    const targetDir = join(this.skillsDir, name);
    if (existsSync(targetDir)) return null;
    mkdirSync(targetDir, { recursive: true });
    const skillPath = join(targetDir, 'SKILL.md');
    writeFileSync(skillPath, this.toSkillMarkdown(name, draft), 'utf-8');
    logger.info('SOP 草案已注册为技能', { name, planId: draft.planId });
    return skillPath;
  }

  /** 草案 → 带 YAML front matter 的 SKILL.md（`description` 用 JSON 字符串安全转义） */
  private toSkillMarkdown(name: string, draft: SopDraft): string {
    const description = JSON.stringify(
      draft.title.replace(/[\r\n]+/g, ' ').slice(0, 120)
    );
    return [
      '---',
      `name: ${JSON.stringify(name)}`,
      `description: ${description}`,
      '---',
      '',
      draft.markdown,
    ].join('\n');
  }

  private writeFile(path: string, draft: SopDraft): void {
    const tmp = `${path}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(draft, null, 2), 'utf-8');
      renameSync(tmp, path);
    } catch (err) {
      void handleError(err, {
        module: 'tasks:evolution:sop',
        action: 'writeDraft',
        context: { id: draft.id },
      });
    }
  }

  private readFile(path: string): SopDraft | null {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as SopDraft;
      if (!parsed || typeof parsed.id !== 'string') return null;
      return parsed;
    } catch (err) {
      // @ignore-catch — 单文件损坏 ⇒ 跳过（不伪造草案）
      logger.warn('SOP 草案文件解析失败，已跳过', {
        file: path,
        error: String(err),
      });
      return null;
    }
  }
}

/** 统计（纯函数；拒绝率无已决草案 ⇒ `null`，不伪造 0） */
export function computeSopDraftStats(
  drafts: readonly SopDraft[]
): SopDraftStats {
  let pending = 0;
  let approved = 0;
  let rejected = 0;
  for (const d of drafts) {
    if (d.status === SOP_DRAFT_PENDING) pending++;
    else if (d.status === SOP_DRAFT_APPROVED) approved++;
    else if (d.status === SOP_DRAFT_REJECTED) rejected++;
  }
  const decided = approved + rejected;
  return {
    total: drafts.length,
    pending,
    approved,
    rejected,
    rejectedRate: decided > 0 ? rejected / decided : null,
  };
}
