/**
 * CG3 模块环境工具 — 最小化路径解析和日志
 *
 * 不依赖 @modules/core 或 @modules/monitoring 以避开循环导入链：
 *   paths.ts → @modules/monitoring → ... → plugins/index.ts → @modules/core → paths.ts
 *
 * 仅在 CG3 独立模块（selfwake/alwayson）内使用。
 */
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { configManager } from '@modules/config';

/** 获取数据子目录路径 */
export function cg3DataDir(sub: string): string {
  // O42（2026-09-13）：删除遗留名 `PYAPP_DATA_DIR` 分支。
  // 它是无人文档化的"隐藏首选覆盖"，与真实入口 `LIRI_DATA_DIR` 双名并存 ——
  // 测试若设旧名会误以为已隔离（实际只有 CG3 模块读它），排查成本高。
  const base =
    configManager.env('LIRI_DATA_DIR') || join(homedir(), '.pyapp', 'data');
  const dir = join(base, sub);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** 最小化 Logger（仅 ERROR/WARN 到 stderr，INFO/DEBUG 到 stdout） */
export function cg3Log(
  module: string,
  level: 'info' | 'warn' | 'error' | 'debug',
  msg: string,
  extra?: Record<string, unknown>
): void {
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase()}] [${module}]`;
  const payload = extra ? ` ${JSON.stringify(extra)}` : '';
  const line = `${prefix} ${msg}${payload}`;
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}
