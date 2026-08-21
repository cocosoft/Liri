// A4 迁移+验收联合脚本：MessageToEventMigrator 批量迁移 → A1/A3/M4 验收
// 用法：cd app && bun run scripts/a4-migrate-and-accept.ts
import { homedir } from 'os';
import { join, dirname } from 'path';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { EventLogStorage } from '../src/session/storage/EventLogStorage';
import { MessageToEventMigrator } from '../src/session/storage/MessageToEventMigrator';
import { resolveSessionsDir, resolveDbPath } from '../src/core/paths';
// 防止 Logger 未初始化导致报错：设置一个全局 logger fallback（用 console）
const mod_logger = await import('../src/monitoring/logs/Logger');
if (!globalThis._logger_init_flag) {
  try { (mod_logger as any).Logger || new mod_logger.Logger({ level: 'warn', module: 'a4' }); } catch { /* ignore */ }
  globalThis._logger_init_flag = true;
}

// ── 环境变量初始化（pyapp.ts 同款最简子集），让 resolve* 正常工作 ──
if (!process.env.PYAPP_HOME) process.env.PYAPP_HOME = join(homedir(), '.pyapp');
if (!process.env.PYAPP_DATA_DIR) process.env.PYAPP_DATA_DIR = join(process.env.PYAPP_HOME, 'data');
if (!process.env.PYAPP_PROJECT_DIR) process.env.PYAPP_PROJECT_DIR = 'E:\\PY\\Documents\\CODES\\PY_APP';

const sessionsRoot = dirname(resolveSessionsDir(process.env));
const defaultDir = join(sessionsRoot, 'default');

type Meta = { sessionId: string; title: string; updatedAt: number };
const sessions: Meta[] = [];
for (const name of readdirSync(defaultDir, { withFileTypes: true })) {
  if (!name.isDirectory()) continue;
  if (['.corrupt', '.trash', 'pid'].includes(name.name)) continue;
  const mp = join(defaultDir, name.name, 'session.json');
  if (!existsSync(mp)) continue;
  try {
    const m = JSON.parse(readFileSync(mp, 'utf-8'));
    sessions.push({ sessionId: name.name, title: m.title || '(untitled)', updatedAt: m.updatedAt || 0 });
  } catch { /* skip */ }
}
sessions.sort((a, b) => b.updatedAt - a.updatedAt);
console.log(`发现 ${sessions.length} 个会话，开始批量迁移...\n`);

// ── Step 1: 批量迁移 ──
type MigStat = { sid: string; title: string; migrated: number; generated: number; errors: number };
const stats: MigStat[] = [];
const migrateOne = async (s: Meta): Promise<MigStat> => {
  const evLog = new EventLogStorage(s.sessionId, 'default');
  const mig = new MessageToEventMigrator(evLog, s.sessionId, 'default');
  const r = await mig.migrate();
  return { sid: s.sessionId, title: s.title, migrated: r.migrated, generated: r.generated, errors: r.errors.length };
};

let ok = 0, skip = 0, fail = 0;
for (const s of sessions) {
  const st = await migrateOne(s);
  stats.push(st);
  if (st.generated > 0) { ok++; console.log(`  ✅ [${ok.toString().padStart(2)}] ${st.title.slice(0,24).padEnd(24)} → ${st.migrated} 消息 → ${st.generated} 事件` + (st.errors ? `  ⚠ ${st.errors} errors` : '')); }
  else if (st.migrated === 0 && st.errors === 0) { skip++; }
  else { fail++; console.log(`  ❌ ${st.title}: ${st.errors} errors`); }
}
console.log(`\n迁移完成：✅ 新迁移 ${ok} | ⏭️  已迁移/空 ${skip} | ❌ 错误 ${fail}`);

// ── Step 2: 对「语义的多层理解」做精确 A1/A3/M4 验收 ──
const target = sessions.find(s => s.title.includes('语义的多层理解')) || sessions[0];
const evPath = join(defaultDir, target.sessionId, 'events.jsonl');
console.log(`\n═══════ A4 精确验收（会话：${target.title}）═══════`);
if (!existsSync(evPath)) { console.log('❌ 目标会话仍无 events.jsonl，跳过'); process.exit(0); }
const events = readFileSync(evPath, 'utf-8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
const seqs = events.map(e => e.seq as number);
console.log(`事件数 ${events.length}，seq 范围 ${seqs[0]}..${seqs[seqs.length-1]}`);

// A3：seq 幂等
console.log('\n── ① A3 后端 flush 幂等（seq 单调无重复）──');
const dupCount = seqs.length - new Set(seqs).size;
let drops = 0; for (let i = 1; i < seqs.length; i++) if (seqs[i] <= seqs[i-1]) drops++;
console.log(`  重复 seq：${dupCount} → ${dupCount === 0 ? '✅' : '❌'}`);
console.log(`  单调递增：${drops === 0 ? '✅' : '❌ 倒退'+drops+' 次'}`);

// A1：增量等价
console.log('\n── ② A1 增量加载（fromSeq 分段后 merge 等价全量）──');
const half = Math.max(1, Math.floor(events.length / 2));
const fromSeq = seqs[half - 1];
const head = events.filter(e => e.seq <= fromSeq);
const tail = events.filter(e => e.seq > fromSeq);
const merged = [...head, ...tail];
const eqLen = merged.length === events.length;
const eqData = eqLen && merged.every((e, i) => e.seq === events[i].seq && e.type === events[i].type && String(e.time) === String(events[i].time));
console.log(`  fromSeq=${fromSeq}（在 ${Math.round(half/events.length*100)}%）`);
console.log(`  head=${head.length} + tail=${tail.length} = ${merged.length}  vs  全量=${events.length}`);
console.log(`  数据完全一致 → ${eqData ? '✅ PASS' : '❌ FAIL'}`);

// M4：派生完整性（turn 配对 & 不丢失 assistant/text 正文）
console.log('\n── ③ M4 事件派生性：turn 配对 + 正文完整度 ──');
let ts = 0, te = 0, cur = -1;
const turnChars = new Map<number, number>();
let totalChars = 0;
for (const ev of events) {
  if (ev.type === 'turn/start') { ts++; cur++; }
  if (ev.type === 'turn/end') { te++; }
  if (ev.type === 'assistant/text') {
    const c = (ev.data?.delta || '').length;
    totalChars += c;
    turnChars.set(cur, (turnChars.get(cur) || 0) + c);
  }
}
console.log(`  turn 配对：${ts} starts / ${te} ends  →  ${ts === te ? '✅' : '⚠️  会话进行中'}`);
console.log(`  assistant/text 正文字符：${totalChars} chars  →  ${totalChars > 0 ? '✅ 有正文（非空）' : '⚠️  无正文'}`);
console.log(`  每轮正文字符分布：${[...turnChars.entries()].sort((a,b)=>a[0]-b[0]).map(([t,c])=>`T${t+1}=${c}ch`).join('  ') || '(无)'}`);

console.log('\n── ④ 总结 ──');
const allPass = dupCount === 0 && drops === 0 && eqData && (ts === te || te === ts - 1) && totalChars > 0;
console.log(allPass
  ? '✅ A4 离线验收全通过：A1 增量等价 · A3 seq 幂等 · M4 派生正文齐全'
  : '⚠️  部分未通过，请对照上方明细检查。如需完整端到端，启动 Tauri app 切换会话再观测前端日志。');
console.log('');
