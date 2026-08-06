/**
 * migrate-skills-vendor.ts
 *
 * 2026-08-06 技能链路归一化迁移脚本（#21）：
 * 将旧版第三方技能（ClawHub 市场安装）从 `~/.pyapp/skills/` 根目录迁移到
 * `~/.pyapp/skills/vendor/` 子目录，与用户技能物理隔离。
 *
 * 判断依据：旧 LocalSkillStore 的 index.json（根目录下）中记录、且
 * installPath 位于 skills 根目录内的技能 = 旧第三方技能。用户技能
 * （手工 SKILL.md，无 index 记录）不会被移动。
 *
 * 用法：
 *   bun run scripts/migrate-skills-vendor.ts
 * 可选环境变量：
 *   LIRI_HOME         覆盖 ~/.pyapp 路径（运行时语义与 resolvePyappHome 一致）
 *   LIRI_PROJECT_DIR  覆盖项目根（默认脚本所在目录的上级）
 *
 * 幂等：已迁移（vendor 下已存在同名目录）自动跳过。
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  rmSync,
  copyFileSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';

// ============ 路径解析（与 resolvePyappHome/resolveUserSkillsDir 对齐） ============

function resolveSkillsDir(): string {
  const home = process.env.LIRI_HOME?.trim();
  if (home) return join(resolve(home), 'skills');
  // 脚本位于 <root>/scripts/ 下 → 项目根 = scripts 的上级
  const projectRoot =
    process.env.LIRI_PROJECT_DIR?.trim() || resolve(dirname(import.meta.dir));
  return join(projectRoot, 'app', 'data', 'pyapp', 'skills');
}

function safeId(skillId: string): string {
  // 与 LocalSkillStore.getSkillInstallPath 一致：仓库形态 skillId 映射为 _
  return skillId.replace(/[:\/\\]/g, '_');
}

/** 路径归一化（Windows 不区分大小写，统一小写 + /） */
function normalize(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

// ============ 主流程 ============

function main(): void {
  const skillsDir = resolveSkillsDir();
  const vendorDir = join(skillsDir, 'vendor');
  const indexPath = join(skillsDir, 'index.json');
  const sourcesPath = join(skillsDir, 'sources.json');
  const auditDir = join(skillsDir, 'audit');
  const vendorIndexPath = join(vendorDir, 'index.json');

  console.log(`[migrate-skills-vendor] skills 根目录: ${skillsDir}`);
  console.log(`[migrate-skills-vendor] vendor 目录:   ${vendorDir}`);

  if (!existsSync(skillsDir)) {
    console.log('[migrate-skills-vendor] skills 目录不存在，无需迁移。');
    return;
  }
  if (!existsSync(indexPath)) {
    console.log(
      '[migrate-skills-vendor] 根目录无 index.json（无旧第三方技能索引），跳过。'
    );
    return;
  }

  mkdirSync(vendorDir, { recursive: true });

  // 1. 读取旧索引
  let index: {
    version: string;
    updatedAt: number;
    skills: Record<string, unknown>;
  };
  try {
    index = JSON.parse(readFileSync(indexPath, 'utf-8'));
  } catch (err) {
    console.error('[migrate-skills-vendor] index.json 解析失败，中止:', err);
    process.exit(1);
  }

  const entries = Object.entries(index.skills || {});
  if (entries.length === 0) {
    console.log('[migrate-skills-vendor] index.json 无技能记录，跳过迁移。');
    return;
  }

  let moved = 0;
  let skipped = 0;
  let remainingInRoot = 0;
  for (const [skillId, record] of entries) {
    const skill = record as {
      installPath?: string;
      meta?: { id?: string; name?: string };
    };
    const id = skillId;
    const safe = safeId(id);
    const oldPath = join(skillsDir, safe);

    // 判断 installPath 是否位于 skills 根目录内（不在 vendor 内）
    // Windows 路径大小写不敏感，统一 normalize 后比较
    const installPath = skill.installPath || '';
    const installNorm = normalize(installPath);
    const skillsNorm = normalize(skillsDir);
    const vendorNorm = normalize(vendorDir);
    const isInRoot =
      !!installPath &&
      installNorm.startsWith(skillsNorm + '/') &&
      !installNorm.startsWith(vendorNorm + '/');

    const targetPath = join(vendorDir, safe);

    if (isInRoot && existsSync(oldPath)) {
      // 迁移目录
      if (existsSync(targetPath)) {
        console.log(
          `[migrate-skills-vendor] 跳过（vendor 已存在）: ${id}`
        );
        skipped++;
      } else {
        renameSync(oldPath, targetPath);
        skill.installPath = targetPath;
        moved++;
        console.log(
          `[migrate-skills-vendor] 已迁移: ${id} -> ${targetPath}`
        );
      }
    } else if (isInRoot && !existsSync(oldPath)) {
      // 索引指向根目录但目录已不存在：视为已迁出/已删，更新索引路径指向 vendor 并计数
      console.log(
        `[migrate-skills-vendor] 目录不存在（视为已迁移）: ${id}`
      );
      skill.installPath = targetPath;
      moved++;
    } else {
      console.log(
        `[migrate-skills-vendor] 跳过（非 skills 根目录）: ${id} (installPath=${installPath || '空'})`
      );
      skipped++;
    }
    // 迁移后再次判断：仍指向根目录的记录 → 需保留根 index 供重试
    const afterNorm = normalize(skill.installPath || '');
    if (
      afterNorm.startsWith(skillsNorm + '/') &&
      !afterNorm.startsWith(vendorNorm + '/')
    ) {
      remainingInRoot++;
    }
  }

  // 2. 合并/写入 vendor/index.json
  let merged = index;
  if (existsSync(vendorIndexPath)) {
    try {
      const existing = JSON.parse(readFileSync(vendorIndexPath, 'utf-8')) as {
        version: string;
        updatedAt: number;
        skills: Record<string, unknown>;
      };
      merged = {
        version: '1.0',
        updatedAt: Date.now(),
        skills: { ...existing.skills, ...index.skills },
      };
    } catch {
      // vendor index 损坏时以根 index 为准
      merged = index;
    }
  }
  writeFileSync(vendorIndexPath, JSON.stringify(merged, null, 2), 'utf-8');
  console.log(`[migrate-skills-vendor] 索引已写入: ${vendorIndexPath}`);

  // 3. 迁移 sources.json / audit/
  if (existsSync(sourcesPath)) {
    const dest = join(vendorDir, 'sources.json');
    if (!existsSync(dest)) {
      copyFileSync(sourcesPath, dest);
      console.log('[migrate-skills-vendor] sources.json 已迁移');
    } else {
      console.log('[migrate-skills-vendor] vendor/sources.json 已存在，保留');
    }
  }
  if (existsSync(auditDir)) {
    const dest = join(vendorDir, 'audit');
    if (!existsSync(dest)) {
      renameSync(auditDir, dest);
      console.log('[migrate-skills-vendor] audit/ 目录已迁移');
    } else {
      console.log('[migrate-skills-vendor] vendor/audit 已存在，保留');
    }
  }

  // 4. 清理根目录旧元数据
  // 仅当所有记录都已迁出根目录时才删除根 index.json（备份后删），
  // 否则保留供下次重试（避免"索引先删、目录未迁"导致数据失联）。
  if (remainingInRoot === 0) {
    const bak = `${indexPath}.bak-vendor-migrate`;
    if (existsSync(indexPath) && !existsSync(bak)) {
      copyFileSync(indexPath, bak);
      console.log(`[migrate-skills-vendor] 根 index.json 已备份: ${bak}`);
    }
    rmSync(indexPath, { force: true });
    console.log('[migrate-skills-vendor] 根 index.json 已移除（全部迁出）');
  } else {
    console.log(
      `[migrate-skills-vendor] 仍有 ${remainingInRoot} 条记录指向根目录，保留根 index.json 供重试。`
    );
  }
  // sources.json / audit/ 与技能目录无关，直接迁移
  if (existsSync(sourcesPath)) {
    const dest = join(vendorDir, 'sources.json');
    if (!existsSync(dest)) {
      copyFileSync(sourcesPath, dest);
      console.log('[migrate-skills-vendor] sources.json 已迁移');
    } else {
      console.log('[migrate-skills-vendor] vendor/sources.json 已存在，保留');
    }
    rmSync(sourcesPath, { force: true });
  }
  if (existsSync(auditDir)) {
    const dest = join(vendorDir, 'audit');
    if (!existsSync(dest)) {
      renameSync(auditDir, dest);
      console.log('[migrate-skills-vendor] audit/ 目录已迁移');
    } else {
      console.log('[migrate-skills-vendor] vendor/audit 已存在，保留');
    }
  }

  console.log(
    `\n[migrate-skills-vendor] 完成: 迁移 ${moved} 个，跳过 ${skipped} 个。`
  );
  console.log(
    `[migrate-skills-vendor] 请重启后端使 LocalSkillStore 以 vendor 目录为准。`
  );
}

main();
