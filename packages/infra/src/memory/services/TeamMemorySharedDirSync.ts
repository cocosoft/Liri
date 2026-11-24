/**
 * 团队记忆 · 共享目录同步（Phase 1 拉取 / Phase 2 推送，2026-11-25）
 *
 * 决策（2026-11-25 用户拍板）：
 * - 服务端归属 = **共享目录**（同步盘/同机目录），本阶段不走网络；
 * - 身份 = 本机身份（`ownerKey` 不参与本阶段）。
 *
 * 语义（只读合并）：
 * - 远端**新 id** ⇒ 导入本地团队目录；
 * - 同 id 且内容相同 ⇒ 跳过（幂等）；
 * - 同 id 内容不同 ⇒ **只记冲突、不覆盖**（沿用既有"冲突不自动改写"裁定）；
 * - 命中密钥 ⇒ 拒收该条（fail-closed），其它条目继续。
 */

import { promises as fs, existsSync } from 'fs';
import { createHash } from 'crypto';
import { basename, join } from 'path';
import matter from 'gray-matter';
import { writeFileAtomic } from '@openliri/infra/utils/atomicFileWrite';
import { getLogger } from '@openliri/infra/monitoring';
import { scanMemoryContent } from '../scanners/MemorySecretScanner';

const logger = getLogger('memory:teamSharedDirSync');

export interface SharedDirPullReport {
  scanned: number;
  imported: number;
  skippedIdentical: number;
  /** 同 id 但内容不同（**未覆盖**本地） */
  conflicts: string[];
  /** 命中密钥而拒收 */
  rejectedSecrets: string[];
  errors: string[];
}

function normalize(raw: string): string {
  return raw.replace(/\r\n/g, '\n').trim();
}

/**
 * 从共享目录拉取团队记忆到本地团队目录（只读合并，幂等）。
 */
export async function pullTeamMemoriesFromSharedDir(params: {
  sharedDir: string;
  localDir: string;
}): Promise<SharedDirPullReport> {
  const { sharedDir, localDir } = params;
  const report: SharedDirPullReport = {
    scanned: 0,
    imported: 0,
    skippedIdentical: 0,
    conflicts: [],
    rejectedSecrets: [],
    errors: [],
  };

  await fs.mkdir(localDir, { recursive: true });

  let files: string[];
  try {
    files = (await fs.readdir(sharedDir)).filter((f) => f.endsWith('.md'));
  } catch (err) {
    report.errors.push(
      `共享目录不可读: ${err instanceof Error ? err.message : String(err)}`
    );
    logger.warn('团队记忆共享目录不可读', { sharedDir });
    return report;
  }

  for (const file of files) {
    report.scanned += 1;
    try {
      const raw = await fs.readFile(join(sharedDir, file), 'utf-8');
      const parsed = matter(raw);
      const id =
        (typeof parsed.data.id === 'string' && parsed.data.id) ||
        basename(file, '.md');

      // 安全：命中密钥 ⇒ 拒收（fail-closed），不写入本地
      if (scanMemoryContent(parsed.content).hasSecrets) {
        report.rejectedSecrets.push(id);
        continue;
      }

      const localPath = join(localDir, `${id}.md`);
      if (existsSync(localPath)) {
        const localRaw = await fs.readFile(localPath, 'utf-8');
        if (normalize(localRaw) === normalize(raw)) {
          report.skippedIdentical += 1;
        } else {
          report.conflicts.push(id);
        }
        continue;
      }

      await writeFileAtomic(localPath, raw);
      report.imported += 1;
    } catch (err) {
      report.errors.push(
        `${file}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  logger.info('团队记忆共享目录拉取完成', {
    sharedDir,
    scanned: report.scanned,
    imported: report.imported,
    skippedIdentical: report.skippedIdentical,
    conflicts: report.conflicts.length,
    rejectedSecrets: report.rejectedSecrets.length,
    errors: report.errors.length,
  });

  return report;
}

export interface SharedDirPushReport {
  scanned: number;
  uploaded: number;
  skippedIdentical: number;
  /** 同 id 但内容不同（**未覆盖**远端） */
  conflicts: string[];
  /** 命中密钥而拒发 */
  rejectedSecrets: string[];
  errors: string[];
}

/**
 * 把本地团队记忆推送到共享目录（Phase 2，2026-11-25）。
 *
 * 与拉取镜像的语义：远端新 id ⇒ 上传；同文 ⇒ 跳过（幂等）；异文 ⇒ **只记冲突、不覆盖**；
 * 命中密钥 ⇒ **拒发**（fail-closed）。
 */
export async function pushTeamMemoriesToSharedDir(params: {
  localDir: string;
  sharedDir: string;
}): Promise<SharedDirPushReport> {
  const { localDir, sharedDir } = params;
  const report: SharedDirPushReport = {
    scanned: 0,
    uploaded: 0,
    skippedIdentical: 0,
    conflicts: [],
    rejectedSecrets: [],
    errors: [],
  };

  await fs.mkdir(sharedDir, { recursive: true });

  let files: string[];
  try {
    files = (await fs.readdir(localDir)).filter((f) => f.endsWith('.md'));
  } catch (err) {
    report.errors.push(
      `本地团队目录不可读: ${err instanceof Error ? err.message : String(err)}`
    );
    logger.warn('团队记忆本地目录不可读', { localDir });
    return report;
  }

  for (const file of files) {
    report.scanned += 1;
    try {
      const raw = await fs.readFile(join(localDir, file), 'utf-8');
      const parsed = matter(raw);
      const id =
        (typeof parsed.data.id === 'string' && parsed.data.id) ||
        basename(file, '.md');

      // 安全：上行前命中密钥 ⇒ 拒发（fail-closed）
      if (scanMemoryContent(parsed.content).hasSecrets) {
        report.rejectedSecrets.push(id);
        continue;
      }

      const remotePath = join(sharedDir, `${id}.md`);
      if (existsSync(remotePath)) {
        const remoteRaw = await fs.readFile(remotePath, 'utf-8');
        if (normalize(remoteRaw) === normalize(raw)) {
          report.skippedIdentical += 1;
        } else {
          report.conflicts.push(id);
        }
        continue;
      }

      await writeFileAtomic(remotePath, raw);
      report.uploaded += 1;
    } catch (err) {
      report.errors.push(
        `${file}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  logger.info('团队记忆共享目录推送完成', {
    sharedDir,
    scanned: report.scanned,
    uploaded: report.uploaded,
    skippedIdentical: report.skippedIdentical,
    conflicts: report.conflicts.length,
    rejectedSecrets: report.rejectedSecrets.length,
    errors: report.errors.length,
  });

  return report;
}

/** 同步历史记录（审计报表，Phase 3-lite） */
export interface TeamSyncHistoryRecord {
  pulled: number;
  pushed: number;
  pullConflicts: number;
  pushConflicts: number;
  rejectedSecrets: number;
  errors: number;
}

/**
 * 追加一条同步历史到 `<team-memory>/sync-history.jsonl`（保留最近 `maxLines` 行）。
 * 只做审计留痕，不参与任何同步判定。
 */
export async function appendTeamSyncHistory(
  teamDir: string,
  record: TeamSyncHistoryRecord,
  maxLines: number = 200
): Promise<void> {
  const file = join(teamDir, 'sync-history.jsonl');
  let existing = '';
  try {
    existing = await fs.readFile(file, 'utf-8');
  } catch {
    existing = '';
  }
  const line = `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`;
  const lines = (existing + line).split('\n').filter((l) => l.trim());
  await writeFileAtomic(file, lines.slice(-maxLines).join('\n') + '\n');
}

/** 冲突候选（manual 语义：只供审阅，不自动改写任何一侧） */
export interface TeamConflictCandidate {
  id: string;
  /** 在哪些方向被发现（`pull` = 远端与本地不同；`push` = 本地与远端不同） */
  directions: string[];
  localFile: string;
  sharedFile: string;
  /** 两侧内容 hash（缺失 = 该侧文件不存在） */
  localHash: string | null;
  sharedHash: string | null;
}

/** 人工取舍方向（Phase 3-lite） */
export type TeamConflictResolution = 'keep_local' | 'keep_shared';

/**
 * 人工采纳冲突的一侧（Phase 3-lite，2026-11-25）。
 *
 * - `keep_local`：本地 → 共享目录（覆盖共享侧）；
 * - `keep_shared`：共享目录 → 本地（覆盖本地侧）；
 * - 两侧文件必须都存在；**采纳的源内容仍要过密钥扫描**（fail-closed）。
 *
 * 只在人工明确调用时执行（不做自动消解，沿用既有裁定）。
 */
export async function resolveTeamConflict(params: {
  id: string;
  teamDir: string;
  sharedDir: string;
  resolution: TeamConflictResolution;
}): Promise<boolean> {
  const { id, teamDir, sharedDir, resolution } = params;
  const localFile = join(teamDir, `${id}.md`);
  const sharedFile = join(sharedDir, `${id}.md`);
  if (!existsSync(localFile) || !existsSync(sharedFile)) return false;

  const [from, to] =
    resolution === 'keep_local'
      ? [localFile, sharedFile]
      : [sharedFile, localFile];

  const raw = await fs.readFile(from, 'utf-8');
  if (scanMemoryContent(matter(raw).content).hasSecrets) {
    logger.warn('团队记忆冲突取舍被拒（源内容命中密钥）', { id, resolution });
    return false;
  }

  await writeFileAtomic(to, raw);
  logger.info('团队记忆冲突已人工取舍', { id, resolution });
  return true;
}

async function fileHash(filePath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return createHash('sha256').update(raw).digest('hex');
  } catch {
    return null;
  }
}

/**
 * 汇总拉/推两个方向的冲突为**审阅候选**（Phase 3-lite，2026-11-25）。
 * 只读取两侧文件计算 hash，不修改任何文件。
 */
export async function buildTeamConflictCandidates(params: {
  teamDir: string;
  sharedDir: string;
  pullConflicts: string[];
  pushConflicts: string[];
}): Promise<TeamConflictCandidate[]> {
  const { teamDir, sharedDir } = params;
  const directions = new Map<string, Set<string>>();
  const add = (ids: string[], direction: string): void => {
    for (const id of ids) {
      const set = directions.get(id) ?? new Set<string>();
      set.add(direction);
      directions.set(id, set);
    }
  };
  add(params.pullConflicts, 'pull');
  add(params.pushConflicts, 'push');

  const candidates: TeamConflictCandidate[] = [];
  for (const id of [...directions.keys()].sort()) {
    const localFile = join(teamDir, `${id}.md`);
    const sharedFile = join(sharedDir, `${id}.md`);
    candidates.push({
      id,
      directions: [...(directions.get(id) ?? [])].sort(),
      localFile,
      sharedFile,
      localHash: await fileHash(localFile),
      sharedHash: await fileHash(sharedFile),
    });
  }
  return candidates;
}
