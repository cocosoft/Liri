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
  const base =
    process.env.PYAPP_DATA_DIR ||
    configManager.env('LIRI_DATA_DIR') ||
    join(homedir(), '.pyapp', 'data');
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
