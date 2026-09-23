#!/usr/bin/env bun
/**
 * 历史「正文短桩」审计与回填（时序/续写错位实证报告 §7 待办 #1，2026-09-22）
 *
 * 背景：`ChatManager` 写投影时曾用"**非空**即采用"⇒ 流式**前导短桩**（如 120 字符）覆盖
 * `blocks` 里的完整正文（实测 2758 字符）。该写路径已修，但**历史记录仍是短桩**。
 *
 * 两类历史记录（处理方式不同）：
 *   A. **有对应事件** ⇒ 读路径 `pickMoreCompleteContent(proj.content, agg.content)` 已能
 *      **自动恢复**（事件是权威源）⇒ **无需回填**；
 *   B. **无对应事件（v0 纯投影）** ⇒ 事件侧无从恢复，唯一本地来源是 `blocks` ⇒ **需回填**。
 *
 * 用法：
 *   bun scripts/repairStubContent.mjs            # 审计（dry-run，默认，只读）
 *   bun scripts/repairStubContent.mjs --apply    # 实际回填（先写 .bak 备份，再原子替换）
 */
import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const APPLY = process.argv.includes('--apply');
const BASE = join(homedir(), '.pyapp', 'data', 'sessions');

/** 短桩判定阈值：blocks 正文比 content 多出这么多字符才算 */
const MIN_GAIN = 200;

const tenants = readdirSync(BASE).filter((t) => {
  try {
    return statSync(join(BASE, t)).isDirectory();
  } catch {
    return false;
  }
});

let scannedSessions = 0;
let scannedRecords = 0;
let stubTotal = 0;
let stubWithEvents = 0;
let stubNoEvents = 0;
let gainBytes = 0;
let appliedRecords = 0;
/** 因"读取后文件被并发改动"而放弃的会话数（宁可漏修，不可覆盖） */
let raceSkipped = 0;
const skippedSessions = [];
const samples = [];

for (const tenant of tenants) {
  const tdir = join(BASE, tenant);
  for (const sid of readdirSync(tdir)) {
    const sdir = join(tdir, sid);
    const msFile = join(sdir, 'messages.jsonl');
    if (!existsSync(msFile)) continue;
    scannedSessions++;

    // 事件侧 messageId 集合（权威源是否覆盖该消息）
    const evFile = join(sdir, 'events.jsonl');
    const eventIds = new Set();
    if (existsSync(evFile)) {
      for (const line of readFileSync(evFile, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line);
          const mid = e.data?.messageId;
          if (typeof mid === 'string') eventIds.add(mid);
        } catch {
          /* 损坏行忽略 */
        }
      }
    }

    // 并发守卫（2026-09-22）：应用**正在运行**时可能同时写该文件（append 新消息 / 整文件重写）。
    // 读取前记录 size+mtime，写回前**重新 stat**，不一致 ⇒ 放弃该会话（宁可漏修，不可覆盖）。
    const stBefore = existsSync(msFile) ? statSync(msFile) : null;
    const raw = readFileSync(msFile, 'utf8');
    const lines = raw.split('\n');
    let changed = false;
    let skippedByRace = false;

    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      scannedRecords++;
      let m;
      try {
        m = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      if (m.role !== 'assistant' || !Array.isArray(m.blocks)) continue;
      const blocksText = m.blocks
        .filter((b) => b?.type === 'text' && typeof b.content === 'string')
        .map((b) => b.content)
        .join('')
        .trim();
      const contentLen = String(m.content ?? '').trim().length;
      if (blocksText.length - contentLen < MIN_GAIN) continue;

      stubTotal++;
      gainBytes += blocksText.length - contentLen;
      const hasEvents = eventIds.has(m.id);
      if (hasEvents) {
        stubWithEvents++;
      } else {
        stubNoEvents++;
        if (samples.length < 10) {
          samples.push({
            session: sid,
            id: String(m.id).slice(0, 8),
            contentLen,
            blocksLen: blocksText.length,
          });
        }
        if (APPLY) {
          m.content = blocksText;
          lines[i] = JSON.stringify(m);
          changed = true;
          appliedRecords++;
        }
      }
    }

    if (APPLY && changed) {
      const stAfter = statSync(msFile);
      if (
        !stBefore ||
        stAfter.size !== stBefore.size ||
        stAfter.mtimeMs !== stBefore.mtimeMs
      ) {
        skippedByRace = true;
        raceSkipped++;
      } else {
        writeFileSync(`${msFile}.bak`, raw, 'utf8');
        const tmp = `${msFile}.tmp`;
        writeFileSync(tmp, lines.join('\n'), 'utf8');
        renameSync(tmp, msFile);
      }
    }
    if (skippedByRace) {
      skippedSessions.push(sid);
    }
  }
}

console.log(`=== 审计（${APPLY ? 'APPLY' : 'DRY-RUN'}）===`);
console.log(`会话 ${scannedSessions} 个；投影记录 ${scannedRecords} 条`);
console.log(`短桩记录（blocks 正文比 content 多 ≥${MIN_GAIN} 字符）: **${stubTotal}** 条`);
console.log(
  `  ├─ A. **有事件**（读路径已可自动恢复，无需回填）: ${stubWithEvents} 条`
);
console.log(
  `  └─ B. **无事件（v0 纯投影）** ⇒ 需回填: **${stubNoEvents}** 条` +
    `（可恢复正文合计 ≈ ${(gainBytes / 1024).toFixed(0)} KB）`
);
if (samples.length > 0) {
  console.log(`\n样例（B 类，前 ${samples.length} 条）:`);
  for (const s of samples) {
    console.log(
      `  ${s.session} id=${s.id}  content=${s.contentLen} → blocks=${s.blocksLen} 字符`
    );
  }
}
console.log(
  APPLY
    ? `\n已回填 ${appliedRecords} 条（原文件备份为 *.jsonl.bak）；因并发改动跳过 ${raceSkipped} 个会话` +
        (skippedSessions.length > 0 ? `：${skippedSessions.slice(0, 5).join(', ')}` : '')
    : `\n（dry-run：未改动任何文件；确认后加 --apply 执行）`
);
