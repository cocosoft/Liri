/**
 * MIT License
 * Copyright (c) 2026 190615273@qq.com
 *
 * 记忆系统迁移脚本：MEMORY.md → 新系统 SQLite
 *
 * 执行方式：
 *   bun run app/scripts/migrate-memory-v1-to-v2.ts
 *
 * 策略：
 *   - 解析 MEMORY.md 中的 --- 分隔 sections
 *   - 逐条导入新系统的 MemoryManagerImpl
 *   - 全量校验（≥ 80% 才算成功）
 *   - 校验失败不标记 .migrated（保留回滚能力）
 *   - 日志输出到 migration-YYYYMMDD-HHmmss.log
 */

// 提前设置环境变量，避免模块初始化时的循环依赖
const { homedir } = await import('os');
const pyappHome = homedir() + '/.pyapp';
process.env.PYAPP_HOME = pyappHome;
process.env.PYAPP_DATA_DIR = pyappHome + '/data';
process.env.PYAPP_PROJECT_DIR = process.cwd();

import { join } from 'path';
import { readFile, copyFile, rename, mkdir, writeFile } from 'fs/promises';
import { MemoryManagerImpl } from '../src/memory/MemoryManager';
import { MemoryType } from '../src/memory/types/MemoryType';

const LEGACY_PATH = join(pyappHome, 'memories', 'MEMORY.md');

interface MigrateResult {
  total: number;
  skipped: number;
  created: number;
  failed: number;
  verified: number;
  success: boolean;
}

const logLines: string[] = [];

function log(msg: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  logLines.push(line);
}

async function main(): Promise<void> {
  log('记忆系统迁移脚本 v1.0');
  log('========================');

  // 1. 读取旧文件
  let content: string;
  try {
    content = await readFile(LEGACY_PATH, 'utf-8');
  } catch {
    log(`旧文件 ${LEGACY_PATH} 不存在，跳过迁移`);
    return;
  }

  if (content.length < 100) {
    log(`旧文件 ${LEGACY_PATH} 内容过短 (${content.length} 字节)，跳过迁移`);
    return;
  }

  // 2. 备份
  const bakPath = `${LEGACY_PATH}.bak.${Date.now()}`;
  await copyFile(LEGACY_PATH, bakPath);
  log(`已备份: ${bakPath}`);

  // 3. 解析 sections
  const sections = content.split('\n---\n').filter((s) => s.trim());
  log(`解析到 ${sections.length} 个 section`);

  // 4. 创建 MemoryManagerImpl 并导入
  const manager = new MemoryManagerImpl();

  const result: MigrateResult = {
    total: sections.length,
    skipped: 0,
    created: 0,
    failed: 0,
    verified: 0,
    success: false,
  };

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i].trim();
    if (!section) {
      result.skipped++;
      continue;
    }

    try {
      // 截取标题（第一行或前 100 字符）
      const firstLine = section.split('\n')[0].replace(/^#+\s*/, '').slice(0, 80) || 'Memory';
      await manager.createMemory({
        content: section,
        metadata: {
          name: firstLine,
          type: MemoryType.USER_FACT,
          tags: ['migration', `v1_${i}`],
          source: 'migration',
        },
      });
      result.created++;
      if ((i + 1) % 20 === 0) {
        log(`进度: ${i + 1}/${sections.length}`);
      }
    } catch (err) {
      result.failed++;
      log(`第 ${i + 1} 条导入失败: ${String(err)}`);
    }
  }

  log(`导入完成: 成功 ${result.created}, 跳过 ${result.skipped}, 失败 ${result.failed}`);

  // 5. 全量校验
  const allMemories = await manager.getAllMemories();
  result.verified = allMemories.length;
  const expected = Math.floor(sections.length * 0.8);

  if (result.verified >= expected) {
    result.success = true;
    log(`校验通过: ${result.verified} >= ${expected} (≥80%)`);

    // 6. 标记已迁移
    const migratedPath = `${LEGACY_PATH}.migrated.${Date.now()}`;
    await rename(LEGACY_PATH, migratedPath);
    log(`已标记为已迁移: ${migratedPath}`);
  } else {
    log(`校验失败: ${result.verified} < ${expected} (≥80%), 不标记已迁移`);
  }

  log('========================');
  log(`迁移${result.success ? '成功' : '失败'}，共 ${result.verified} 条记忆`);
  log(`日志已保存到: migration-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

  // 7. 写入日志文件
  const logPath = join(
    process.cwd(),
    `migration-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.log`,
  );
  await writeFile(logPath, logLines.join('\n'), 'utf-8');
}

main().catch((err) => {
  console.error('迁移脚本异常:', err);
  process.exit(1);
});
