#!/usr/bin/env bun
/**
 * RSS 任务级/隔离评估（2026-09-02，C P3-7f 基准收尾的后置核验项）
 *
 * 背景：复测 #2 运行期 monitoring:service/diagnostics 记录的进程级 RSS 峰值
 * 3,969-4,424MB，超 §12 "≤1.5GB" 名义目标。但该采样为**进程全量**（长驻模块 +
 * 空闲基线已 ~1.4GB），非任务/会话数据隔离口径。
 *
 * 本脚本在**独立 bun 进程**内，用**真实会话 events.jsonl + 真实存储代码**
 * （EventLogStorage：快照常驻/idx/流式读）度量"单会话数据"的内存成本：
 *   - 进程启动 + 模块加载后取基线（rss/heapUsed）
 *   - 打开真实会话存储 → read() 首次（建快照常驻）→ read() 二次（快照热路径）
 *   - 输出各阶段 rss/heapUsed 与增量 = 该会话数据的隔离内存成本
 *
 * 用法（app 目录下）：
 *   bun run scripts/measure-session-memory.ts [sessionId ...]
 *   不传则度量 §12 记录的 5 个真实会话（复测 #1/#2 + 修复前 + 基线）。
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { EventLogStorage } from '../src/session/storage/EventLogStorage';

const SESSIONS_ROOT = join(homedir(), '.pyapp', 'data', 'sessions');

const DEFAULTS: Array<{ id: string; note: string }> = [
  { id: 'session_mtk8s3rcblu0q9aeepg', note: '复测#2 长任务(修复后构建)' },
  { id: 'session_mtk86qarx2ureef4tn', note: '复测#1 短跑(修复后构建)' },
  { id: 'session_mtk4sge98esk485avo8', note: '修复前同型(10,422 事件)' },
  { id: 'session_mtjdmjpo89bsqnmxp4o', note: 'P3-7f 基线(5,961 事件)' },
  { id: 'session_mtjkl9r6dp33xng6eik', note: '修复前(5,780 事件)' },
];

function memTag(label: string): void {
  const m = process.memoryUsage();
  console.log(
    `  [mem:${label}] rss=${(m.rss / 1048576).toFixed(1)}MB ` +
      `heapUsed=${(m.heapUsed / 1048576).toFixed(1)}MB external=${(m.external / 1048576).toFixed(1)}MB`
  );
}

function fileLines(p: string): number {
  try {
    const content = readFileSync(p, 'utf-8');
    return content.split('\n').filter((l) => l.trim().length > 0).length;
  } catch {
    return 0;
  }
}

async function measure(id: string, note: string): Promise<void> {
  const eventsPath = join(SESSIONS_ROOT, 'default', id, 'events.jsonl');
  if (!existsSync(eventsPath)) {
    console.log(`skip ${id}: events.jsonl 不存在`);
    return;
  }
  const lines = fileLines(eventsPath);
  const bytes = existsSync(eventsPath) ? (await import('node:fs')).statSync(eventsPath).size : 0;
  console.log(`\n=== ${id}（${note}）events 行数=${lines} 字节=${(bytes / 1024).toFixed(0)}KB idx=${existsSync(join(SESSIONS_ROOT, 'default', id, 'events.idx'))} ===`);
  const base = process.memoryUsage();
  const s = new EventLogStorage(id, 'default', SESSIONS_ROOT);
  const r1 = await s.read({ limit: 10000, fromSeq: 1 });
  const m1 = process.memoryUsage();
  const r2 = await s.read({ limit: 10000, fromSeq: 1 });
  const m2 = process.memoryUsage();
  const tail = await s.getTailSeq();
  const mb = (b: number): number => b / 1048576;
  console.log(
    `  基线(进程+模块) rss=${mb(base.rss).toFixed(1)}MB | ` +
      `read#1 返回 ${r1.length} 条 → rss=${mb(m1.rss).toFixed(1)}MB(+${mb(m1.rss - base.rss).toFixed(1)}) ` +
      `heap+${mb(m1.heapUsed - base.heapUsed).toFixed(1)} | ` +
      `read#2(热) → rss=${mb(m2.rss).toFixed(1)}MB(+${mb(m2.rss - m1.rss).toFixed(1)}) | tailSeq=${tail}`
  );
  void r2;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  memTag('进程基线(模块加载后)');
  const targets = args.length > 0 ? args.map((id) => ({ id, note: '命令行指定' })) : DEFAULTS;
  for (const t of targets) {
    await measure(t.id, t.note);
  }
  memTag('结束');
  // 模块懒加载的定时器/句柄会保持事件循环存活，显式退出
  process.exit(0);
}

main().catch((err) => {
  console.error(`度量失败: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
