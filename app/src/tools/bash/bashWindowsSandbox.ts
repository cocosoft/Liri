// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * Windows bash 的**真写隔离**（2026-11-07，方案 §10）。
 *
 * **为什么需要这一层**：`win-sandbox-run.exe` 只做「Low IL + Job Object」，**不做路径授权**
 * （见 `sandbox/win/native/win_sandbox_run.c`）。Low IL 进程默认写不了 Medium 目录，而用户仓库
 * 就是 Medium ⇒ 要让 bash 能写工作区，必须**临时**给这些目录打 Low 完整性标签
 * （`icacls /setintegritylevel`），执行完再恢复。
 *
 * **取证（2026-11-07 真机）**：
 * - `icacls <dir> /grant *S-1-16-4096:(OI)(CI)(M)` 只是把 Low SID 当"强制标签"写进 SACL，
 *   实测**不足以**让 Low IL 进程写入（`mkdir` 仍 `Access is denied`）；
 * - `icacls <dir> /setintegritylevel (OI)(CI)Low` 才是有效形态：Low IL 进程可写，且标签按
 *   `(OI)(CI)` 继承到整棵子树；把父目录恢复成 Medium 后，子对象随继承一并恢复；
 * - 恢复会在**被授权目录本身**留下一条显式的 `Medium Mandatory Level:(OI)(CI)(NW)` 标签
 *   （原本无显式标签的目录），语义与"继承 Medium"等价；这是本方案已知的残留，已记录在方案 §10。
 * - **改标签需要目录的 `WRITE_OWNER`**：常见仓库目录只给 `Authenticated Users:(M)`（不含 WO）
 *   ⇒ 首次执行时补一条 `*<SID>:(WO)` ACE 并在**进程内缓存**（补/撤都会触发整棵目录树的 ACL 传播，
 *   15 万文件实测 ≈ 8s），命令结束**不撤**，由下次启动统一撤销。
 *
 * **崩溃兜底**：每次授权立即把 `{dir, restoreLevel}` 落台账（`~/.pyapp/data/`），临时 WO ACE 也记
 * 在同一份台账；进程被杀 / 强退导致 `finally` 没跑到时，下次启动由
 * `cleanupStaleWindowsBashGrants()` 恢复标签并撤掉 ACE。
 *
 * **只做「写」隔离**：读与网络不受限（与 Landlock / Seatbelt 的口径一致，见方案 §7.1）。
 */

import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { resolveDataDir } from '@openliri/infra/environment';
import { getLogger } from '@openliri/infra/monitoring';

const logger = getLogger('tools:bash:windows-sandbox');
const execFileAsync = promisify(execFile);

/** 完整性级别（`icacls /setintegritylevel` 的取值） */
export type IntegrityLevel = 'Low' | 'Medium' | 'High' | 'System';

export interface IcaclsResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

/** `icacls` 执行器（**可注入**：离线测试不需要真的改 ACL） */
export type IcaclsRunner = (args: string[]) => Promise<IcaclsResult>;

/** 默认执行器：调用系统 `icacls.exe`（非 0 退出码不抛错，统一收敛成 `ok:false`） */
export const defaultIcaclsRunner: IcaclsRunner = async (args) => {
  try {
    const { stdout, stderr } = await execFileAsync('icacls.exe', args, {
      windowsHide: true,
      timeout: 15_000,
    });
    return { ok: true, stdout: String(stdout), stderr: String(stderr) };
  } catch (error) {
    const enriched = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      ok: false,
      stdout: String(enriched.stdout ?? ''),
      stderr: String(enriched.stderr ?? ''),
      error: enriched.message ?? String(error),
    };
  }
};

/** 构造「把目录（含子对象）完整性标签设为 level」的 argv（纯函数） */
export function buildIntegrityLevelArgs(
  dir: string,
  level: IntegrityLevel
): string[] {
  return [dir, '/setintegritylevel', `(OI)(CI)${level}`];
}

/**
 * 从 `icacls <dir>` 的输出里解析**显式**完整性标签（无显式标签 ⇒ `null`）。
 *
 * ⚠️ 这里必须做文本解析：`icacls` 是唯一"普通权限即可读标签"的通道
 * （读 SACL 需 `SeSecurityPrivilege`，而 `LABEL_SECURITY_INFORMATION` 不需要）；
 * 输出随系统语言变化 ⇒ 同时认中英文关键词（`CS02` 的例外：外部工具输出没有语言中立编码）。
 */
export function parseIntegrityLevel(text: string): IntegrityLevel | null {
  for (const line of text.split(/\r?\n/)) {
    if (!/mandatory level|强制级别/i.test(line)) continue;
    if (/\blow\b|低/i.test(line)) return 'Low';
    if (/\bmedium\b|中/i.test(line)) return 'Medium';
    if (/\bhigh\b|高/i.test(line)) return 'High';
    if (/\bsystem\b|系统/i.test(line)) return 'System';
  }
  return null;
}

/** 沿父目录向上找**生效**的完整性级别（都没有显式标签 ⇒ NTFS 默认 Medium） */
async function resolveEffectiveLevel(
  startDir: string,
  run: IcaclsRunner
): Promise<IntegrityLevel> {
  let current = resolve(startDir);
  for (;;) {
    const out = await run([current]);
    if (!out.ok) return 'Medium';
    const level = parseIntegrityLevel(out.stdout);
    if (level) return level;
    const parent = dirname(current);
    if (parent === current) return 'Medium';
    current = parent;
  }
}

/** 台账条目（崩溃兜底用；`restoreLevel` = 授权前的**显式**级别或生效级别） */
export interface IntegrityGrantEntry {
  dir: string;
  restoreLevel: IntegrityLevel;
}

const JOURNAL_FILE_NAME = 'bash-win-integrity-grants.json';

/** 台账路径（`~/.pyapp/data/`；可被 `LIRI_DATA_DIR` 覆盖，统一走 environment） */
export function resolveGrantJournalPath(): string {
  return join(resolveDataDir(), JOURNAL_FILE_NAME);
}

/**
 * 台账内容。
 *
 * - `entries`：**本次要恢复的标签**（每条命令结束即清；崩溃时由启动清理补做）；
 * - `writeOwners`：为了改标签而临时补的 `WRITE_OWNER` ACE（改标签需要该权限，用户仓库通常没有）。
 *   ⚠️ 该 ACE 的增删会触发**整棵目录树的 ACL 传播**（真机实测 15 万文件 ≈ 8s），
 *   故按用户 2026-11-07 决策**进程内缓存**：首条命令补一次，之后复用，**下次启动**统一撤掉
 *   （见 `cleanupStaleWindowsBashGrants`）。残留期间它只授给"目录所有者自己"，
 *   而所有者的 WRITE_DAC 本就能做到同等事情 ⇒ 实际权限增量≈0。
 */
export interface IntegrityJournal {
  entries: IntegrityGrantEntry[];
  writeOwners: string[];
}

function isGrantEntry(value: unknown): value is IntegrityGrantEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<IntegrityGrantEntry>;
  return (
    typeof entry.dir === 'string' &&
    typeof entry.restoreLevel === 'string' &&
    ['Low', 'Medium', 'High', 'System'].includes(entry.restoreLevel)
  );
}

/** 读整份台账（不存在 / 损坏 ⇒ 空，不阻断启动） */
export function readIntegrityJournal(journalPath: string): IntegrityJournal {
  try {
    const parsed = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries?: unknown[];
      writeOwners?: unknown[];
    };
    return {
      entries: Array.isArray(parsed.entries)
        ? parsed.entries.filter(isGrantEntry)
        : [],
      writeOwners: Array.isArray(parsed.writeOwners)
        ? parsed.writeOwners.filter(
            (dir): dir is string => typeof dir === 'string' && dir.length > 0
          )
        : [],
    };
  } catch {
    // @ignore-catch 台账缺失/损坏：视为空（损坏不应阻断启动，也不能凭它去改 ACL）
    return { entries: [], writeOwners: [] };
  }
}

/** 只读"待恢复标签"条目（调用方/测试更常用） */
export function readGrantJournal(journalPath: string): IntegrityGrantEntry[] {
  return readIntegrityJournal(journalPath).entries;
}

function writeIntegrityJournal(
  journalPath: string,
  journal: IntegrityJournal
): void {
  try {
    mkdirSync(dirname(journalPath), { recursive: true });
    const tmp = `${journalPath}.tmp`;
    writeFileSync(
      tmp,
      JSON.stringify({ version: 2, ...journal }, null, 2),
      'utf8'
    );
    renameSync(tmp, journalPath);
  } catch (error) {
    // @ignore-catch 台账写失败不影响本次授权（最坏情况：崩溃后残留标签/ACE）
    logger.warn('bash: windows-grant-journal-failed', {
      error: String(error),
    });
  }
}

/** 进程内已授权目录（引用计数：并发命令共用同一目录时，最后一个释放才恢复） */
interface ActiveGrant {
  refs: number;
  restoreLevel: IntegrityLevel;
}

const activeGrants = new Map<string, ActiveGrant>();

function grantKey(dir: string): string {
  // Windows 路径大小写不敏感 ⇒ 用规范化小写做键（避免同一目录被授权两次）
  return resolve(dir).toLowerCase();
}

/** 构造「临时授 WRITE_OWNER」的 argv（改完整性标签需要它；只作用于目录本身，不继承） */
export function buildWriteOwnerArgs(dir: string, sid: string): string[] {
  return [dir, '/grant', `*${sid}:(WO)`];
}

/** 构造「撤销临时 WRITE_OWNER」的 argv（只删显式 ACE，继承 ACE 不受影响） */
export function buildRemoveWriteOwnerArgs(dir: string, sid: string): string[] {
  return [dir, '/remove:g', `*${sid}`];
}

/**
 * 当前用户的 SID（`whoami /user`；缓存）。
 *
 * 用 SID 而不是账号名：`icacls /grant *S-1-5-…` 不受域名/本地账号/微软账号的命名差异影响。
 */
let cachedUserSid: string | null | undefined;

export type UserSidResolver = () => Promise<string | null>;

const defaultUserSidResolver: UserSidResolver = async () => {
  if (cachedUserSid !== undefined) return cachedUserSid;
  try {
    const { stdout } = await execFileAsync('whoami.exe', ['/user'], {
      windowsHide: true,
      timeout: 10_000,
    });
    const match = String(stdout).match(/S-1-5-[\d-]+/);
    cachedUserSid = match ? match[0] : null;
  } catch {
    // @ignore-catch 取不到 SID ⇒ 放弃 WRITE_OWNER 兜底（授权会以"权限不足"失败，可归因）
    cachedUserSid = null;
  }
  return cachedUserSid;
};

/** 失败原因（目录 + 可读错误） */
export interface WindowsBashGrantFailure {
  dir: string;
  error: string;
}

export interface WindowsBashGrantSession {
  /** 全部目录都授权成功（否则调用方按 `failClosed` 决定拒绝还是降级） */
  ok: boolean;
  granted: string[];
  failures: WindowsBashGrantFailure[];
  /** `finally` 里调用：逐个降引用，归零时恢复原标签并清台账 */
  release: () => Promise<void>;
}

export interface WindowsBashGrantDeps {
  runIcacls?: IcaclsRunner;
  journalPath?: string;
  pathExists?: (path: string) => boolean;
  /** 当前用户 SID（默认 `whoami /user`；测试注入） */
  resolveUserSid?: UserSidResolver;
}

/** 去重 + 去不存在（不存在的目录**跳过**，不当作失败：如受管产物目录可能尚未创建） */
function normalizeDirs(
  dirs: string[],
  pathExists: (path: string) => boolean
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of dirs) {
    if (!dir) continue;
    const key = grantKey(dir);
    if (seen.has(key) || !pathExists(dir)) continue;
    seen.add(key);
    out.push(dir);
  }
  return out;
}

function failureOf(
  dir: string,
  out: IcaclsResult,
  fallback: string
): WindowsBashGrantFailure {
  return { dir, error: out.error ?? (out.stderr.trim() || fallback) };
}

/**
 * 把目录标签设为 Low；缺 `WRITE_OWNER` 时**补一次** ACE 并记台账（进程内复用）。
 *
 * 背景（真机取证）：改完整性标签需要对象的 `WRITE_OWNER`，而常见仓库目录只给
 * `Authenticated Users:(M)`（不含 WRITE_OWNER）⇒ 直接 `/setintegritylevel` 报 `Access is denied`。
 * 补/撤 `(WO)` 会触发整棵目录树的 ACL 传播（15 万文件 ≈ 8s）⇒ 只在**第一次**补，
 * 之后靠台账里已有的记录复用，命令结束**不撤**（见 `IntegrityJournal` 的说明）。
 */
async function setLowIntegrity(
  dir: string,
  run: IcaclsRunner,
  journalPath: string,
  sid: string | null
): Promise<
  | { ok: true; addedWriteOwner: boolean }
  | { ok: false; failure: WindowsBashGrantFailure }
> {
  const first = await run(buildIntegrityLevelArgs(dir, 'Low'));
  if (first.ok) return { ok: true, addedWriteOwner: false };

  const journal = readIntegrityJournal(journalPath);
  const hasAce = journal.writeOwners.some(
    (entry) => grantKey(entry) === grantKey(dir)
  );
  if (!hasAce) {
    if (!sid) {
      return {
        ok: false,
        failure: failureOf(dir, first, 'icacls 设置完整性标签失败'),
      };
    }
    const grant = await run(buildWriteOwnerArgs(dir, sid));
    if (!grant.ok) {
      return {
        ok: false,
        failure: failureOf(dir, grant, '无法临时授予 WRITE_OWNER'),
      };
    }
    writeIntegrityJournal(journalPath, {
      ...journal,
      writeOwners: [...journal.writeOwners, dir],
    });
    logger.info('bash: windows-grant-write-owner', { dir });
  }

  const retry = await run(buildIntegrityLevelArgs(dir, 'Low'));
  if (!retry.ok) {
    if (!hasAce && sid) {
      // 补了权限仍失败 ⇒ 撤掉刚加的 ACE（错误路径，代价可接受）
      await run(buildRemoveWriteOwnerArgs(dir, sid));
      const after = readIntegrityJournal(journalPath);
      writeIntegrityJournal(journalPath, {
        ...after,
        writeOwners: after.writeOwners.filter(
          (entry) => grantKey(entry) !== grantKey(dir)
        ),
      });
    }
    return {
      ok: false,
      failure: failureOf(dir, retry, 'icacls 设置完整性标签失败'),
    };
  }
  return { ok: true, addedWriteOwner: !hasAce };
}

/** 给单个目录打 Low 标签并记台账（失败返回原因，不抛错） */
async function grantOne(
  dir: string,
  run: IcaclsRunner,
  journalPath: string,
  sid: string | null
): Promise<WindowsBashGrantFailure | null> {
  const probe = await run([dir]);
  if (!probe.ok) {
    return failureOf(dir, probe, 'icacls 读取目录失败');
  }
  // 台账里**已有**该目录 ⇒ 说明上次释放没成功（残余 Low 标签）。
  // 必须沿用最原始的 restoreLevel，否则会把"恢复到 Low"当成目标，永久留下 Low。
  const previous = readGrantJournal(journalPath).find(
    (entry) => grantKey(entry.dir) === grantKey(dir)
  );
  const restoreLevel =
    previous?.restoreLevel ??
    parseIntegrityLevel(probe.stdout) ??
    (await resolveEffectiveLevel(dirname(resolve(dir)), run));

  const low = await setLowIntegrity(dir, run, journalPath, sid);
  if (!low.ok) return low.failure;

  activeGrants.set(grantKey(dir), { refs: 1, restoreLevel });
  const journal = readIntegrityJournal(journalPath);
  writeIntegrityJournal(journalPath, {
    ...journal,
    entries: [
      ...journal.entries.filter(
        (entry) => grantKey(entry.dir) !== grantKey(dir)
      ),
      { dir, restoreLevel },
    ],
  });
  logger.info('bash: windows-grant', {
    dir,
    restoreLevel,
    addedWriteOwner: low.addedWriteOwner,
  });
  return null;
}

/**
 * 撤销一个目录的**标签**（引用计数归零时调用）。
 *
 * 临时 `WRITE_OWNER` ACE **不在这里撤销**（进程内复用，见 `IntegrityJournal`）；
 * 它由下次启动的 `cleanupStaleWindowsBashGrants` 统一撤掉。
 *
 * @returns 是否恢复成功（失败时标签条目保留，交给下次启动重试）
 */
async function revokeLabel(
  dir: string,
  restoreLevel: IntegrityLevel,
  run: IcaclsRunner,
  journalPath: string
): Promise<boolean> {
  const restore = await run(buildIntegrityLevelArgs(dir, restoreLevel));
  if (!restore.ok) {
    logger.warn('bash: windows-revoke-failed', {
      dir,
      restoreLevel,
      error: restore.error ?? restore.stderr.trim(),
    });
    return false;
  }
  const journal = readIntegrityJournal(journalPath);
  writeIntegrityJournal(journalPath, {
    ...journal,
    entries: journal.entries.filter(
      (entry) => grantKey(entry.dir) !== grantKey(dir)
    ),
  });
  logger.info('bash: windows-revoke', { dir, restoreLevel });
  return true;
}

/** 释放一组目录：引用计数归零时恢复原标签 */
async function releaseGrants(
  dirs: string[],
  run: IcaclsRunner,
  journalPath: string
): Promise<void> {
  for (const dir of dirs) {
    const key = grantKey(dir);
    const active = activeGrants.get(key);
    if (!active) continue;
    active.refs -= 1;
    if (active.refs > 0) continue;

    activeGrants.delete(key);
    await revokeLabel(dir, active.restoreLevel, run, journalPath);
  }
}

/**
 * 执行前授权：把可写目录**临时**降为 Low 完整性（其余写操作由 MIC 拒绝）。
 *
 * 调用方**必须**在 `finally` 里调用 `release()`。
 */
export async function beginWindowsBashGrants(
  dirs: string[],
  deps: WindowsBashGrantDeps = {}
): Promise<WindowsBashGrantSession> {
  const run = deps.runIcacls ?? defaultIcaclsRunner;
  const journalPath = deps.journalPath ?? resolveGrantJournalPath();
  const pathExists = deps.pathExists ?? existsSync;
  // SID 只在真需要（WRITE_OWNER 兜底）时才用到，但仍提前解析一次以便复用
  const sid = await (deps.resolveUserSid ?? defaultUserSidResolver)();

  const granted: string[] = [];
  const failures: WindowsBashGrantFailure[] = [];
  for (const dir of normalizeDirs(dirs, pathExists)) {
    const active = activeGrants.get(grantKey(dir));
    if (active) {
      active.refs += 1;
      granted.push(dir);
      continue;
    }
    const failure = await grantOne(dir, run, journalPath, sid);
    if (failure) failures.push(failure);
    else granted.push(dir);
  }

  return {
    ok: failures.length === 0,
    granted,
    failures,
    release: () => releaseGrants(granted, run, journalPath),
  };
}

/** 测试用：清空进程内引用计数（不碰真实 ACL） */
export function resetWindowsBashGrantsForTest(): void {
  activeGrants.clear();
}

export interface StaleGrantCleanupResult {
  restored: string[];
  failures: WindowsBashGrantFailure[];
}

/**
 * 启动时清掉上次进程的遗留：
 *  ① 先把还在 Low 的目录标签恢复（`finally` 没跑到：崩溃 / 强杀 / 断电）；
 *  ② 再撤掉为改标签而临时补的 `WRITE_OWNER` ACE（进程内缓存，见 `IntegrityJournal`）。
 *
 * 恢复/撤销失败的条目**保留在台账里**（下次启动重试），不静默丢弃。
 */
export async function cleanupStaleWindowsBashGrants(
  deps: WindowsBashGrantDeps & { platform?: NodeJS.Platform } = {}
): Promise<StaleGrantCleanupResult> {
  const platform = deps.platform ?? process.platform;
  if (platform !== 'win32') return { restored: [], failures: [] };

  const run = deps.runIcacls ?? defaultIcaclsRunner;
  const journalPath = deps.journalPath ?? resolveGrantJournalPath();
  const pathExists = deps.pathExists ?? existsSync;

  const journal = readIntegrityJournal(journalPath);
  if (journal.entries.length === 0 && journal.writeOwners.length === 0) {
    return { restored: [], failures: [] };
  }
  const sid = await (deps.resolveUserSid ?? defaultUserSidResolver)();

  const restored: string[] = [];
  const failures: WindowsBashGrantFailure[] = [];
  for (const entry of journal.entries) {
    if (!pathExists(entry.dir)) continue;
    const ok = await revokeLabel(
      entry.dir,
      entry.restoreLevel,
      run,
      journalPath
    );
    if (ok) {
      restored.push(entry.dir);
      logger.info('bash: windows-revoke-stale', {
        dir: entry.dir,
        restoreLevel: entry.restoreLevel,
      });
    } else {
      failures.push({
        dir: entry.dir,
        error: '恢复完整性标签失败（详见日志）',
      });
    }
  }

  // ② 撤掉临时 WRITE_OWNER（标签已不在 Low 上，顺序不能反）
  if (!sid) return { restored, failures };
  const remainingAce: string[] = [];
  for (const dir of readIntegrityJournal(journalPath).writeOwners) {
    if (!pathExists(dir)) continue;
    const removed = await run(buildRemoveWriteOwnerArgs(dir, sid));
    if (removed.ok) {
      logger.info('bash: windows-revoke-write-owner', { dir });
      continue;
    }
    logger.warn('bash: windows-revoke-wo-failed', {
      dir,
      error: removed.error ?? removed.stderr.trim(),
    });
    remainingAce.push(dir);
  }
  writeIntegrityJournal(journalPath, {
    ...readIntegrityJournal(journalPath),
    writeOwners: remainingAce,
  });
  return { restored, failures };
}

/** 命令转交用的环境变量名（见 `buildWindowsBashInvocation` 的引号说明） */
export const WINDOWS_BASH_CMD_ENV = 'LIRI_BASH_CMD';

export interface WindowsBashInvocation {
  program: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * 按 `cmd` 的 `%NAME%` 语法展开环境变量（大小写不敏感；未定义的**原样保留**）。
 *
 * 为什么要自己做：命令文本经**环境变量**转交（见 `buildWindowsBashInvocation`），
 * cmd 对 `%LIRI_BASH_CMD%` 的展开是**单遍**的 ⇒ 值里的 `%TEMP%` 不会再展开。
 * 交给 `call` 做第二遍又会把重定向目标弄坏（真机实测 `call echo hi > %TEMP%\x` 报
 * "The system cannot find the path specified"）⇒ 先在 Node 侧展开能解析的，
 * 只把**动态变量**（`%CD%` / `%ERRORLEVEL%` 等不在 env 里的）留给 `call`。
 */
export function expandWindowsEnvVars(
  command: string,
  env: Record<string, string | undefined>
): string {
  const lowered = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    lowered.set(key.toLowerCase(), value);
  }
  return command.replace(/%([^%\s]+)%/g, (match, name: string) => {
    const value = lowered.get(name.toLowerCase());
    return value === undefined ? match : value;
  });
}

/**
 * 构造 `win-sandbox-run.exe -- cmd.exe …` 的**内层**程序/参数（纯函数）。
 *
 * ⚠️ **不能**把命令直接作为 argv 交给 helper：helper 的 `build_command_line` 会把含空格的参数
 * 整体加引号、并把内部的 `"` 转义成 `\"`，而 `cmd.exe` 不认反斜杠转义
 * ⇒ 真机实测 `echo "a b"` 输出 `\"a b\"`、`node -e "…"` 静默失败。
 * 因此改由**环境变量**转交命令文本（环境块是 UTF-16，且不经 argv 引号规则）：
 * - 先在 Node 侧展开 `%VAR%`（`expandWindowsEnvVars`，避免 `call` 弄坏重定向）；
 * - 仍有残留 `%`（动态变量如 `%ERRORLEVEL%`）⇒ `cmd /d /s /c call %LIRI_BASH_CMD%`（第二遍展开）；
 * - 无残留 ⇒ `cmd /d /s /c %LIRI_BASH_CMD%`（一遍展开，保真度最高）。
 */
export function buildWindowsBashInvocation(input: {
  command: string;
  env?: Record<string, string | undefined>;
  comspec?: string;
}): WindowsBashInvocation {
  const env = input.env ?? {};
  // `ComSpec` 走**传入的 child env**（不直接读 process.env，R05-012）
  const program = input.comspec?.trim() || env.ComSpec?.trim() || 'cmd.exe';
  const command = expandWindowsEnvVars(input.command, env);
  const placeholder = `%${WINDOWS_BASH_CMD_ENV}%`;
  const script = command.includes('%') ? `call ${placeholder}` : placeholder;
  return {
    program,
    args: ['/d', '/s', '/c', script],
    env: { [WINDOWS_BASH_CMD_ENV]: command },
  };
}

/**
 * 输出里是否出现「拒绝访问」类信号（写隔离确实生效时的典型报错）。
 *
 * 与 `tools/CodeRunner/WindowsSandboxRunner.classifyWinSandboxDenial` 同一组关键词；
 * 不直接复用是因为那个模块会连带 `CrossPlatformRunner`（bun RPC 栈）进 bash 执行路径。
 */
export function isWindowsAccessDenied(text: string | undefined): boolean {
  if (!text) return false;
  return /access is denied|permission denied|拒绝访问|eperm|eacces|unauthorizedaccess/i.test(
    text
  );
}
