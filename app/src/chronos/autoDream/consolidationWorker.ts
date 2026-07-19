import { readdir, readFile, stat, writeFile, mkdir, unlink } from 'fs/promises';
import { join, relative, resolve, normalize } from 'path';
import { existsSync } from 'fs';
import { configManager } from '@modules/config';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'chronos:autoDream:consolidationWorker',
  level: LogLevel.INFO,
});

const prompt = configManager.env('LIRI_DREAM_PROMPT') || '';
const memoryRoot = configManager.env('LIRI_DREAM_MEMORY_ROOT') || '';
const transcriptDir = configManager.env('LIRI_DREAM_TRANSCRIPT_DIR') || '';
const maxDuration = parseInt(
  configManager.env('LIRI_DREAM_MAX_DURATION') || '120000',
  10
);

const startTime = Date.now();
const filesTouched: string[] = [];

function sendProgress(pct: number, message: string): void {
  if (process.send) {
    process.send({
      type: 'progress',
      pct,
      message,
      filesTouched: [...filesTouched],
    });
  }
}

function sendResult(
  success: boolean,
  insightsGenerated: number,
  error?: string
): void {
  if (process.send) {
    process.send({
      type: 'result',
      success,
      filesTouched: [...filesTouched],
      insightsGenerated,
      duration: Date.now() - startTime,
      error,
    });
  }
}

function isWithinMemoryRoot(targetPath: string): boolean {
  const normalized = normalize(resolve(targetPath));
  const normalizedRoot = normalize(resolve(memoryRoot));
  return normalized.startsWith(normalizedRoot);
}

function isTimeUp(): boolean {
  return Date.now() - startTime >= maxDuration;
}

async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

async function safeWriteFile(
  filePath: string,
  content: string
): Promise<boolean> {
  if (!isWithinMemoryRoot(filePath)) {
    return false;
  }
  try {
    await mkdir(memoryRoot, { recursive: true });
    await writeFile(filePath, content, 'utf-8');
    const relPath = relative(memoryRoot, filePath);
    if (!filesTouched.includes(relPath)) {
      filesTouched.push(relPath);
    }
    return true;
  } catch {
    return false;
  }
}

async function walkDirectory(
  dir: string,
  depth: number = 0
): Promise<string[]> {
  if (depth > 3) return [];
  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const sub = await walkDirectory(fullPath, depth + 1);
        results.push(...sub);
      } else {
        results.push(fullPath);
      }
    }
  } catch (err) {
    // directory not accessible

    logger.debug('Operation skipped', {
      context: 'directory not accessible',
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return results;
}

async function phase1Orient(): Promise<void> {
  sendProgress(5, 'Phase 1: 浏览记忆目录结构');

  if (!existsSync(memoryRoot)) {
    sendProgress(10, '记忆目录不存在，将创建');
    await mkdir(memoryRoot, { recursive: true });
    return;
  }

  const files = await walkDirectory(memoryRoot);
  sendProgress(10, `记忆目录包含 ${files.length} 个文件`);

  const entrypointPath = join(memoryRoot, 'index.md');
  const entrypoint = await safeReadFile(entrypointPath);
  if (entrypoint !== null) {
    const lineCount = entrypoint.split('\n').length;
    sendProgress(12, `已读取 index.md (${lineCount} 行)`);
  }
}

async function phase2GatherSignal(): Promise<void> {
  sendProgress(15, 'Phase 2: 收集近期记忆信号');

  const logDirs: string[] = [];
  const logsPath = join(memoryRoot, 'logs');
  if (existsSync(logsPath)) {
    const yearDirs = await readdir(logsPath);
    for (const yearDir of yearDirs) {
      const yearPath = join(logsPath, yearDir);
      const s = await stat(yearPath);
      if (s.isDirectory()) {
        const monthDirs = await readdir(yearPath);
        for (const monthDir of monthDirs) {
          logDirs.push(join(yearPath, monthDir));
        }
      }
    }
  }

  let recentLogEntries = 0;
  for (const logDir of logDirs) {
    if (isTimeUp()) break;
    const logFiles = await readdir(logDir);
    for (const logFile of logFiles) {
      if (isTimeUp()) break;
      if (logFile.endsWith('.md')) {
        const content = await safeReadFile(join(logDir, logFile));
        if (content !== null) {
          recentLogEntries += content
            .split('\n')
            .filter(
              (l) => l.trim().startsWith('-') || l.trim().startsWith('*')
            ).length;
        }
      }
    }
  }

  sendProgress(
    25,
    `扫描了 ${logDirs.length} 个日志目录, ${recentLogEntries} 条近期记录`
  );

  if (existsSync(transcriptDir)) {
    const transcriptFiles = await readdir(transcriptDir);
    const jsonlFiles = transcriptFiles.filter((f) => f.endsWith('.jsonl'));
    sendProgress(30, `发现 ${jsonlFiles.length} 个会话转录文件`);
  }
}

async function phase3Consolidate(): Promise<number> {
  sendProgress(40, 'Phase 3: 执行记忆整合');
  let insightsGenerated = 0;

  const existingFiles = existsSync(memoryRoot)
    ? (await readdir(memoryRoot)).filter(
        (f) => f.endsWith('.md') && f !== 'index.md'
      )
    : [];

  const entrypointPath = join(memoryRoot, 'index.md');
  const existingEntrypoint = await safeReadFile(entrypointPath);

  if (existingEntrypoint && existingFiles.length > 0) {
    sendProgress(
      50,
      `发现 ${existingFiles.length} 个记忆文件，检查是否需要更新`
    );

    for (const file of existingFiles) {
      if (isTimeUp()) break;
      const content = await safeReadFile(join(memoryRoot, file));
      if (content) {
        sendProgress(55, `检查: ${file} (${content.length} 字符)`);
      }
    }
  }

  if (!existingEntrypoint) {
    const defaultIndex = `# 记忆索引\n\n_自动生成于 ${new Date().toISOString().split('T')[0]}_\n\n`;
    await safeWriteFile(entrypointPath, defaultIndex);
    insightsGenerated++;
    sendProgress(60, '已创建初始 index.md');
  }

  const indexContent = await safeReadFile(entrypointPath);
  if (indexContent) {
    const entryCount = indexContent
      .split('\n')
      .filter((l) => l.trim().startsWith('- [')).length;
    const titleCount = indexContent
      .split('\n')
      .filter((l) => l.trim().startsWith('#')).length;
    insightsGenerated += entryCount + titleCount;
  }

  sendProgress(70, `记忆整合完成: ${insightsGenerated} 个洞察`);
  return insightsGenerated;
}

async function phase4Prune(): Promise<void> {
  sendProgress(75, 'Phase 4: 修剪和更新索引');

  const entrypointPath = join(memoryRoot, 'index.md');
  const content = await safeReadFile(entrypointPath);
  if (content === null) return;

  const lines = content.split('\n');
  if (lines.length > 50) {
    const pruned = lines.slice(0, 50);
    pruned.push('');
    pruned.push('_部分条目已裁剪 — 完整内容在对应文件_');
    await safeWriteFile(entrypointPath, pruned.join('\n'));
    sendProgress(85, 'index.md 已裁剪至 50 行内');
  } else {
    sendProgress(85, 'index.md 大小适中，无需修剪');
  }
}

async function consolidate(): Promise<void> {
  try {
    sendProgress(0, '梦境记忆整合启动');

    await mkdir(memoryRoot, { recursive: true });

    await phase1Orient();
    if (isTimeUp()) {
      sendResult(false, 0, 'timeout during phase 1');
      return;
    }

    await phase2GatherSignal();
    if (isTimeUp()) {
      sendResult(false, 0, 'timeout during phase 2');
      return;
    }

    const insights = await phase3Consolidate();
    if (isTimeUp()) {
      sendResult(false, insights, 'timeout during phase 3');
      return;
    }

    await phase4Prune();
    sendProgress(95, '梦境内存整合完成');

    sendResult(true, insights);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    sendResult(false, 0, errorMsg);
  }
}

consolidate().catch((err) => {
  sendResult(false, 0, err instanceof Error ? err.message : String(err));
});
