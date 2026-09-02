#!/usr/bin/env bun
/**
 * 日志窗口分析工具（2026-09-02 排查"会话中断"用）
 *
 * 用法：
 *   bun run scripts/logscan.ts --from 13:26:00 --to 13:34:00 [--re 正则] [--head N] [--raw]
 *
 * 从 app.log 中按 UTC 时间窗口过滤（纯字符串解析，避开 PowerShell ConvertFrom-Json 陷阱），
 * 输出：HH:mm:ss [level] module: message + meta(截断 140)。
 */
import { readFileSync } from 'node:fs';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const logPath =
  arg('log') ?? 'C:\\Users\\csdnc\\.pyapp\\data\\logs\\app.log';
const from = arg('from') ?? '00:00:00';
const to = arg('to') ?? '23:59:59';
const reSrc = arg('re');
const head = arg('head') ? Number(arg('head')) : 60;
const re = reSrc ? new RegExp(reSrc) : null;

const lines = readFileSync(logPath, 'utf-8').split('\n');
let shown = 0;
for (const line of lines) {
  if (!line.trim()) continue;
  const tm = line.match(/"timestamp":"([^"]+)"\s*,\s*"level":"([^"]+)"\s*,\s*"module":"([^"]+)"\s*,\s*"message":"((?:[^"\\]|\\.)*)"/);
  if (!tm) continue;
  const time = tm[1].slice(11, 19); // HH:mm:ss (UTC)
  if (time < from || time > to) continue;
  if (re && !re.test(line)) continue;
  const level = tm[2];
  const module = tm[3];
  let message = tm[4].replace(/\\(.)/g, '$1');
  let meta = '';
  const metaM = line.match(/"meta":(\{.*\})\s*\}\s*$/);
  if (metaM) {
    meta = metaM[1];
    if (meta.length > 160) meta = meta.slice(0, 160);
  }
  console.log(`${time} [${level}] ${module}: ${message}${meta ? ' ' + meta : ''}`);
  shown++;
  if (shown >= head) break;
}
console.log(`--- shown ${shown} lines (from=${from} to=${to}) ---`);
