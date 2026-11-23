#!/usr/bin/env bun
/**
 * R12 —— 依赖**许可证合规**扫描（离线，第九轮审查 §5.3-2）。
 *
 * 背景：§5.3 要求"依赖漏洞和许可证检查"。现状核验：
 *   - **漏洞**：CI `ci.yml` 已有 `bun audit --ignore-fixes`（非阻塞）⇒ **已存在**；
 *   - **许可证**：**无**任何扫描 ⇒ 本脚本补齐该缺口。
 *
 * 做法：离线遍历已安装依赖（`app/node_modules` / `client/node_modules`），读取各
 * `package.json` 的 `license`（含 legacy `licenses` 数组 / `{type}` 对象），按 **SPDX 片段**
 * 判定分为 `permissive` / `copyleft` / `unknown` 三类并汇总。**默认非阻塞**（报告 + 退出 0）；
 * 传 `--fail-on=copyleft` 或 `--fail-on=unknown` 可升级为阻断（供"分级门禁"按需收紧）。
 *
 * 用法（仓库根目录）：
 *   bun run scripts/check-license-compliance.ts
 *   bun run scripts/check-license-compliance.ts --fail-on=copyleft
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const SCAN_DIRS = ['app/node_modules', 'client/node_modules'];

/** 宽松（permissive）许可片段（SPDX 片段匹配，大小写不敏感）。 */
const PERMISSIVE = [
  'MIT',
  'ISC',
  'APACHE-2.0',
  'BSD-2-CLAUSE',
  'BSD-3-CLAUSE',
  '0BSD',
  'UNLICENSE',
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-3.0',
  'PYTHON-2.0',
  'BLUEOAK-1.0.0',
  'ZLIB',
  'WTFPL',
  'ARTISTIC-2.0',
  'BSL-1.0',
  'MIT-0',
  // 2026-11-23：SIL Open Font License（字体专用宽松许可；@fontsource-* 依赖常见）
  'OFL-1.1',
  'SIL-OFL-1.1',
];
/** 传染性 / 需复核（copyleft）许可片段。MPL 为弱 copyleft ⇒ 归入需复核。 */
const COPYLEFT = [
  'AGPL',
  'GPL',
  'LGPL',
  'SSPL',
  'EUPL',
  'OSL',
  'CDDL',
  'CPL',
  'MPL-2.0',
];

type Verdict = 'permissive' | 'copyleft' | 'unknown';

/**
 * 2026-11-23：**已复核接受**台账（把"非阻断报告"升级为真正的门禁）。
 *
 * 背景：本脚本此前默认 exit 0（仅报告），若接进 CI 也只是"永远绿"的空转门禁。
 * 现支持 `--fail-on=copyleft,unknown` 阻断，但**只阻断未登记的依赖**；
 * 已人工复核并接受的条目写入 `.trae/architecture/license-allowlist.json`（必须写理由）。
 *
 * 键支持**前缀通配**（`@img/sharp-*` / `lightningcss-*`）：同一包的各平台预编译产物
 * 许可相同，逐个列出会在异构 CI 上因"平台差异"误报（Linux 安装的是 linux 变体）。
 */
const LICENSE_ALLOWLIST_PATH = join(
  ROOT,
  '.trae',
  'architecture',
  'license-allowlist.json'
);

interface LicenseAllowlist {
  packages?: Record<string, { reason?: string }>;
}

function loadLicenseAllowlist(): Record<string, string> {
  if (!existsSync(LICENSE_ALLOWLIST_PATH)) return {};
  try {
    const raw = JSON.parse(
      readFileSync(LICENSE_ALLOWLIST_PATH, 'utf-8')
    ) as LicenseAllowlist;
    const out: Record<string, string> = {};
    for (const [pattern, entry] of Object.entries(raw.packages ?? {})) {
      const reason =
        typeof entry?.reason === 'string' ? entry.reason.trim() : '';
      if (reason) out[pattern] = reason;
    }
    return out;
  } catch (error) {
    console.error(
      `❌ 许可证台账无法解析：${LICENSE_ALLOWLIST_PATH}\n  ${String(error)}`
    );
    process.exit(1);
  }
}

/** 精确名或前缀通配（`xxx-*`）命中已接受台账 */
function findAllowlistReason(
  name: string,
  allowlist: Record<string, string>
): string | undefined {
  if (allowlist[name]) return allowlist[name];
  for (const [pattern, reason] of Object.entries(allowlist)) {
    if (pattern.endsWith('*') && name.startsWith(pattern.slice(0, -1))) {
      return reason;
    }
  }
  return undefined;
}

interface Pkg {
  name: string;
  version: string;
  license: string;
  verdict: Verdict;
}

/** 归一化 `package.json` 的 license 字段为字符串。 */
function normalizeLicense(pkg: Record<string, unknown>): string {
  const raw = pkg.license;
  if (typeof raw === 'string') return raw.trim();
  if (raw && typeof raw === 'object' && 'type' in raw) {
    const t = (raw as { type?: unknown }).type;
    if (typeof t === 'string') return t.trim();
  }
  const legacy = pkg.licenses;
  if (Array.isArray(legacy)) {
    const types = legacy
      .map((l) =>
        l && typeof l === 'object' && 'type' in l
          ? String((l as { type?: unknown }).type ?? '')
          : ''
      )
      .filter(Boolean);
    if (types.length > 0) return types.join(' OR ');
  }
  return '';
}

function classify(license: string): Verdict {
  if (!license) return 'unknown';
  const l = license.toUpperCase();
  // 双许可（`A OR B`）：任一分支为宽松 ⇒ 使用者可选宽松分支 ⇒ 判为 permissive。
  if (l.includes(' OR ')) {
    const alts = l.split(' OR ');
    if (alts.some((a) => PERMISSIVE.some((p) => a.includes(p)))) {
      return 'permissive';
    }
  }
  if (COPYLEFT.some((c) => l.includes(c))) return 'copyleft';
  if (PERMISSIVE.some((p) => l.includes(p))) return 'permissive';
  return 'unknown';
}

/** 枚举一个 node_modules 下的全部包（含 `@scope/name`）。 */
function collectFrom(nmDir: string): Pkg[] {
  const out: Pkg[] = [];
  if (!existsSync(nmDir)) return out;
  for (const entry of readdirSync(nmDir)) {
    if (entry.startsWith('.')) continue;
    const full = join(nmDir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (entry.startsWith('@')) {
      for (const sub of readdirSync(full)) {
        const pkgJson = join(full, sub, 'package.json');
        if (existsSync(pkgJson)) out.push(readPkg(entry + '/' + sub, pkgJson));
      }
    } else {
      const pkgJson = join(full, 'package.json');
      if (existsSync(pkgJson)) out.push(readPkg(entry, pkgJson));
    }
  }
  return out;
}

function readPkg(name: string, pkgJson: string): Pkg {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(readFileSync(pkgJson, 'utf-8')) as Record<
      string,
      unknown
    >;
  } catch {
    // @ignore-catch — 失败时按"未知许可"登记，不中断扫描
  }
  const license = normalizeLicense(data);
  return {
    name: (typeof data.name === 'string' && data.name) || name,
    version: typeof data.version === 'string' ? data.version : '?',
    license,
    verdict: classify(license),
  };
}

function main(): void {
  const failOn = (process.argv.find((a) => a.startsWith('--fail-on=')) ?? '')
    .split('=')[1]
    ?.split(',') as Verdict[] | undefined;

  const pkgs: Pkg[] = [];
  for (const rel of SCAN_DIRS) pkgs.push(...collectFrom(join(ROOT, rel)));

  const allowlist = loadLicenseAllowlist();
  const copyleftAll = pkgs.filter((p) => p.verdict === 'copyleft');
  const unknownAll = pkgs.filter((p) => p.verdict === 'unknown');
  const permissiveCount = pkgs.length - copyleftAll.length - unknownAll.length;

  const accepted: Pkg[] = [];
  const copyleft: Pkg[] = [];
  const unknown: Pkg[] = [];
  for (const p of [...copyleftAll, ...unknownAll]) {
    if (findAllowlistReason(p.name, allowlist)) accepted.push(p);
    else if (p.verdict === 'copyleft') copyleft.push(p);
    else unknown.push(p);
  }

  console.log('=== R12 依赖许可证合规扫描（离线）===');
  console.log(`扫描目录: ${SCAN_DIRS.join(' · ')}`);
  console.log(
    `依赖总数 ${pkgs.length} · permissive ${permissiveCount} · ` +
      `已复核接受 ${accepted.length} · copyleft(未接受) ${copyleft.length} · unknown(未接受) ${unknown.length}`
  );

  if (accepted.length > 0) {
    console.log('\n--- 已复核接受（台账登记）---');
    for (const p of accepted) {
      console.log(
        `  ${p.name}@${p.version}  ${p.license || '(无声明)'}  ⇒ ${findAllowlistReason(p.name, allowlist)}`
      );
    }
  }
  if (copyleft.length > 0) {
    console.log('\n--- 需复核（copyleft，未登记）---');
    for (const p of copyleft)
      console.log(`  ${p.name}@${p.version}  ${p.license}`);
  }
  if (unknown.length > 0) {
    console.log('\n--- 无声明 / 未知许可（unknown，未登记）---');
    for (const p of unknown) console.log(`  ${p.name}@${p.version}`);
  }

  // 台账陈旧条目只**告警**不阻断：依赖按平台安装（sharp / lightningcss 的 linux/darwin
  // 变体不会同时存在），跨平台 CI 上"本机未安装"是正常现象。
  const installedNames = new Set(pkgs.map((p) => p.name));
  const stale = Object.keys(allowlist).filter(
    (pattern) => !pattern.endsWith('*') && !installedNames.has(pattern)
  );
  if (stale.length > 0) {
    console.warn(
      `\n⚠️ 台账条目在本机未安装（跨平台属正常，勿据此删条目）：${stale.join(', ')}`
    );
  }

  const shouldFail =
    failOn &&
    failOn.some(
      (v) =>
        (v === 'copyleft' && copyleft.length > 0) ||
        (v === 'unknown' && unknown.length > 0)
    );
  console.log(
    shouldFail
      ? '\n❌ 命中 --fail-on 条件：存在**未登记**的 copyleft/unknown 依赖（补台账需写明复核理由）'
      : '\n✅ 扫描完成' +
          (failOn?.length
            ? '（fail-on 已启用：未登记的 copyleft/unknown 会阻断）'
            : '（非阻断：仅报告；可用 --fail-on=copyleft,unknown 收紧）')
  );
  process.exit(shouldFail ? 1 : 0);
}

main();
