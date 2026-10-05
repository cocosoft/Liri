/**
 * 大小写同名碰撞检查器（Case-Collision Linter）—— §3-6 防回归守卫（2026-10-05）
 *
 * **背景**（spec `governance-g-group.md` §3-5/§3-6）：G1 的"Windows 大小写不敏感"打包风险 ——
 * 同一目录下若存在仅大小写不同的两个条目（`Foo` 与 `foo`），在**大小写敏感**文件系统（Linux）
 * 上可并存，但检出 / 打包 / 安装到**大小写不敏感**文件系统（Windows / macOS 默认）上时：
 *  - git checkout 会**互相覆盖**（后写者胜），内容丢失且无告警；
 *  - 模块解析 / 打包产物命名会出现"时有时无"的诡异失败。
 * 本机此前**未**对该形态设防 ⇒ 本检查器把"仅大小写不同的同级条目"变成**可自动发现的违规**。
 *
 * **检查范围**：项目树内**同一父目录**下的直接子项（文件或目录），按 `toLowerCase()` 分组，
 * 组内出现 >1 个**互不相同**的名字即违规。忽略构建/依赖/缓存目录（见 IGNORE_DIRS）。
 *
 * 运行：cd app && bun run lint:case（cwd = app/，项目根 = ../）
 * 实现约束：Windows 无系统 grep，全部用 Node 内置 API（对齐 lint-script-exit.ts）。
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** 项目根目录（scripts/ 的父目录） */
const PROJECT_ROOT = join(import.meta.dir, '..');

/**
 * 跳过的目录名（**大小写不敏感**比较）：依赖 / VCS / 构建产物 / 缓存 —— 它们不属于
 * 我们要保护的手写源码与打包输入，且体量巨大（扫之无益且拖慢）。
 */
const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'target',
  'coverage',
  '.trash',
  '.venv',
  '__pycache__',
  '.turbo',
  '.vite',
  '.cache',
]);

interface Collision {
  /** 冲突所在父目录（相对项目根，POSIX 分隔符） */
  dir: string;
  /** 仅大小写不同的名字列表（原样） */
  names: string[];
}

/**
 * 纯函数：把**同一父目录**下的条目名按"仅大小写不同"分组，返回冲突组（组内 >1 个互异名）。
 *
 * 抽成纯函数是为了**自检控制组**（见 `selfCheck`）—— 守卫若"永远返回空"便是空集假绿，
 * 必须能在合成输入上证明它**确实能命中**。
 */
export function groupCaseCollisions(names: string[]): string[][] {
  const byLower = new Map<string, string[]>();
  for (const name of names) {
    const key = name.toLowerCase();
    const bucket = byLower.get(key);
    if (bucket) bucket.push(name);
    else byLower.set(key, [name]);
  }
  const groups: string[][] = [];
  for (const bucket of byLower.values()) {
    if (bucket.length > 1) groups.push([...bucket].sort());
  }
  return groups;
}

/** 自检：合成 `['Foo','foo']` 必须命中；`['Foo','bar']` 必须不命中（防"恒真/恒假"） */
function selfCheck(): void {
  const hit = groupCaseCollisions(['Foo', 'foo']);
  const miss = groupCaseCollisions(['Foo', 'bar']);
  if (hit.length !== 1 || miss.length !== 0) {
    console.error(
      '❌ 守卫自检失败：大小写碰撞判定不满足控制组（hit=1 / miss=0）⇒ 守卫本身已损坏。'
    );
    process.exit(1);
  }
}

/** 递归扫描：收集"同一父目录下仅大小写不同的条目" */
function scan(dirAbs: string, dirRel: string, out: Collision[]): void {
  let entries;
  try {
    entries = readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    // 权限 / 竞态导致的不可读目录：跳过（非本检查职责）
    return;
  }

  const visible = entries.filter(
    (entry) =>
      !(entry.isDirectory() && IGNORE_DIRS.has(entry.name.toLowerCase()))
  );
  for (const names of groupCaseCollisions(visible.map((e) => e.name))) {
    out.push({ dir: dirRel === '' ? '.' : dirRel, names });
  }

  for (const entry of visible) {
    if (!entry.isDirectory()) continue;
    scan(
      join(dirAbs, entry.name),
      dirRel === '' ? entry.name : `${dirRel}/${entry.name}`,
      out
    );
  }
}

function main(): void {
  selfCheck();

  const collisions: Collision[] = [];
  scan(PROJECT_ROOT, '', collisions);

  if (collisions.length > 0) {
    console.error(
      '❌ 检测到"仅大小写不同"的同级条目（大小写不敏感文件系统上会互相覆盖 / 打包失败）：'
    );
    for (const c of collisions) {
      console.error(`  - ${c.dir}/  →  ${c.names.join('  |  ')}`);
    }
    console.error(
      '\n原因：Linux（大小写敏感）可并存，但 Windows / macOS（默认不敏感）检出与打包时' +
        '会互相覆盖且无告警（spec governance-g-group.md §3-5/§3-6）。' +
        '\n修法：重命名其中之一，使同一父目录下不存在仅大小写不同的条目。'
    );
    process.exit(1);
  }

  console.log('✅ 大小写同名碰撞检查通过（未发现仅大小写不同的同级条目）');
  process.exit(0);
}

main();
