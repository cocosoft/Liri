/**
 * 知识库存量重复扫描（只读，P2 知识库清理阶段 0）
 * 扫描 ~/.pyapp/knowledge/ 全树，按 SHA-256 内容分组统计重复，
 * 并查询 file_files 表（inbound MD5 体系）的重复组。
 *
 * 运行：bun run scripts/scan-knowledge-duplicates.ts（cwd = 仓库根，会 chdir 到 app）
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Database } from 'bun:sqlite';

const ROOT = process.cwd();
// 兼容在仓库根或 app/ 下运行
const APP_DIR = existsSync(join(ROOT, 'app', 'src')) ? join(ROOT, 'app') : ROOT;
const HOME = join(APP_DIR, 'data', 'pyapp');
const KNOWLEDGE_DIR = join(HOME, 'knowledge');
const DB_PATH = join(HOME, 'data', 'app.db');

const SHA256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// ── 1. 内容 SHA-256 分组（raw/ 全树 + knowledge/ 编译产物） ──
console.log(`\n=== 知识库扫描 ===`);
console.log(`知识库根: ${KNOWLEDGE_DIR} (exists: ${existsSync(KNOWLEDGE_DIR)})`);

const files = walk(KNOWLEDGE_DIR).filter((f) =>
  /\.(md|txt|ipynb|json|markdown)$/i.test(f)
);
console.log(`候选文件: ${files.length}`);

const byHash = new Map<string, { size: number; files: string[] }>();
const sizeGroups = new Map<number, string[]>();
for (const f of files) {
  const st = statSync(f);
  const arr = sizeGroups.get(st.size) || [];
  arr.push(f);
  sizeGroups.set(st.size, arr);
}

let readCount = 0;
for (const [size, group] of sizeGroups) {
  if (group.length < 2) continue; // 同大小才可能重复
  for (const f of group) {
    const h = SHA256(readFileSync(f));
    const entry = byHash.get(h) || { size, files: [] };
    entry.files.push(f);
    byHash.set(h, entry);
    readCount++;
  }
}

const dupGroups = [...byHash.values()].filter((g) => g.files.length > 1);
console.log(`已算 hash: ${readCount} 个文件`);
console.log(`重复组（SHA-256 相同）: ${dupGroups.length} 组`);
let dupFileCount = 0;
// 位置分类统计
const pos = (f: string) => {
  const rel = relative(KNOWLEDGE_DIR, f).split(/[\\/]/);
  return rel[0] === 'raw' && rel[1] === 'inbound' ? 'inbound' : rel[0] === 'raw' ? 'raw顶层' : rel[0];
};
const catCount = new Map<string, number>();
for (const g of dupGroups) {
  const cats = [...new Set(g.files.map(pos))].sort().join('+');
  catCount.set(cats, (catCount.get(cats) || 0) + 1);
  dupFileCount += g.files.length - 1;
}
console.log(`重复组位置构成:`);
for (const [cats, n] of [...catCount.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cats}: ${n} 组`);
}
for (const g of dupGroups) {
  console.log(`\n[组 ${g.size} bytes]`);
  for (const f of g.files) console.log(`  ${relative(KNOWLEDGE_DIR, f)}`);
}
console.log(`\n可删除文件数（每组留 1）: ${dupFileCount}`);

// ── 2. file_files 表 MD5 重复（inbound 分区） ──
if (existsSync(DB_PATH)) {
  console.log(`\n=== file_files 表检查 ===`);
  console.log(`DB: ${DB_PATH}`);
  try {
    const db = new Database(DB_PATH, { readonly: true });
    const dupMd5 = db
      .query(
        `SELECT md5, COUNT(*) AS cnt FROM file_files WHERE is_deleted = 0 GROUP BY md5 HAVING cnt > 1`
      )
      .all() as Array<{ md5: string; cnt: number }>;
    console.log(`MD5 重复组: ${dupMd5.length} 组`);
    for (const d of dupMd5) {
      const rows = db
        .query(
          `SELECT file_id, original_name, saved_path, ref_count FROM file_files WHERE md5 = ? AND is_deleted = 0`
        )
        .all(d.md5) as Array<{
        file_id: string;
        original_name: string;
        saved_path: string;
        ref_count: number;
      }>;
      console.log(`\n[md5 ${d.md5} ×${d.cnt}]`);
      for (const r of rows)
        console.log(`  id=${r.file_id} name=${r.original_name} path=${r.saved_path} ref=${r.ref_count}`);
    }
    // file_files 中已标记删除但物理仍存在的（软删未清理）
    const softDeleted = db
      .query(`SELECT COUNT(*) AS c FROM file_files WHERE is_deleted = 1`)
      .get() as { c: number };
    console.log(`\n软删记录(is_deleted=1): ${softDeleted.c} 条`);
    db.close();
  } catch (err) {
    console.log(`file_files 查询失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log(`\n=== 扫描完成 ===`);
