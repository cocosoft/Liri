/**
 * 团队记忆 · 共享目录单向拉取（Phase 1，2026-11-25）
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
import { basename, join } from 'path';
import matter from 'gray-matter';
import { writeFileAtomic } from '@openliri/infra/utils/atomicFileWrite';
import { getLogger } from '@openliri/infra/monitoring';
import { scanMemoryContent } from '../scanners/MemorySecretScanner';

const logger = getLogger('memory:teamSharedDirPull');

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
