/**
 * CG3 模块环境工具 — 最小化路径解析和日志
 *
 * 不依赖 @modules/core 或 @openliri/infra/monitoring 以避开循环导入链：
 *   paths.ts → @openliri/infra/monitoring → ... → plugins/index.ts → @modules/core → paths.ts
 *
 * 仅在 CG3 独立模块（selfwake/alwayson）内使用。
 */
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { configManager } from '@openliri/infra/config';

/** 获取数据子目录路径 */
export function cg3DataDir(sub: string): string {
  // 2026-11-06：只读契约键 `LIRI_DATA_DIR`（`PYAPP_DATA_DIR` 是已弃用别名，
  // 与 `resolveDataDir()` 不同源 ⇒ 同一进程里两套路径会不一致）。
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
