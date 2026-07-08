/**
 * init-dirs.ts — 预创建运行时数据目录
 *
 * 在安装/部署阶段运行，替代运行时 mkdir 开销。
 * 用法:
 *   bun run scripts/init-dirs.ts
 *   bun run scripts/init-dirs.ts --home=/custom/path
 */

import { mkdirSync, existsSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

const ROOT_LEVEL_DIRS = [
  'data',
  'data/governance',
  'data/governance/audit',
  'data/governance/strategies',
  'data/sessions',
  'data/transcripts',
  'data/memory',
  'data/attachments',
  'data/cache',
  'data/security',
  'data/chronos',
  'data/snapshots',
  'data/oauth',
  'data/permissions',
  'data/artifacts',
  'data/models',
  'data/pairings',
  'data/knowledge',
  'data/knowledge/raw',
  'data/inbound',
  'data/skills',
  'data/permissions/user',
  'data/output',
  'data/media',
  'data/temp',
  'data/downloads',
  'data/team-memory',
  'data/user-memory',
  'logs',
];

function main(): void {
  const args = process.argv.slice(2);
  let home = join(homedir(), '.pyapp');

  for (const arg of args) {
    if (arg.startsWith('--home=')) {
      home = resolve(arg.split('=')[1]);
    }
  }

  console.log(`Liri 数据目录初始化`);
  console.log(`目标: ${home}\n`);

  let created = 0;
  let existed = 0;

  for (const dir of ROOT_LEVEL_DIRS) {
    const fullPath = join(home, dir);
    if (existsSync(fullPath)) {
      existed++;
    } else {
      try {
        mkdirSync(fullPath, { recursive: true });
        created++;
        console.log(`  [创建] app/${dir}`);
      } catch (err) {
        console.error(`  [失败] app/${dir}: ${(err as Error).message}`);
      }
    }
  }

  // 种子文件：SOUL.md 和 USER.md
  const soulPath = join(home, 'SOUL.md');
  if (!existsSync(soulPath)) {
    writeFileSync(soulPath, '# Liri SOUL\n\n欢迎使用 Liri。\n');
    console.log(`  [种子] SOUL.md`);
  }
  const userPath = join(home, 'USER.md');
  if (!existsSync(userPath)) {
    writeFileSync(userPath, '# User Profile\n\n在这里描述你的偏好和习惯。\n');
    console.log(`  [种子] USER.md`);
  }

  console.log(`\n完成: 新建 ${created}，已存在 ${existed}，总计 ${ROOT_LEVEL_DIRS.length}`);
}

main();
