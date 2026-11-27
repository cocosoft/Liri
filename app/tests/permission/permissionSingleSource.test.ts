/**
 * `lint:permission-single-source` 自证（P2-2 / P2-3，2026-11-03；R1 扩展 2026-11-17；
 * ⑤ 审批可执行性契约 2026-11-24）。
 *
 * 立论同 `gateParity.test.ts`：门禁"跑绿了"不等于"真的会报"。
 * 本文件钉死五件事：
 *   ① 真实仓库：单一来源 + 工具规则 HTTP 写入口唯一 + 审批产生点均接终局预检（exit 0）；
 *   ② 负向对照：非规范文件再写一份危险表 / 只读目录 / 废弃常量 ⇒ exit 1 并点名；
 *   ③ 负向对照：HTTP 层出现 `tool_rules.json` 或第二个 `/v1/permissions/rules` 路由 ⇒ exit 1；
 *   ④ 解析失败（扫描目录缺失）⇒ exit 1，不得静默当作通过；
 *   ⑤ 负向对照：bash 工具新增未登记的 `requireApproval` 出口、或丢掉预检接线 ⇒ exit 1；
 *   ⑦ 负向对照：白名单被挪到 deny 门之前 / 少了一道 deny 门 / 定位不到 `runSecurityGates` ⇒ exit 1。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = join(process.cwd(), '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'lint-permission-single-source.ts');

const temps: string[] = [];
afterAll(() => {
  for (const t of temps) {
    try {
      rmSync(t, { recursive: true, force: true });
    } catch {
      // 清理失败不影响断言
    }
  }
});

/**
 * 造一棵最小工程树：
 * - `app/src/dup.ts`（默认）或指定相对路径的源文件；
 * - `packages/infra/src/index.ts` 占位（满足"扫描到源文件"）。
 */
function fixture(dupSource: string, relPath = 'app/src/dup.ts'): string {
  const dir = mkdtempSync(join(tmpdir(), 'liri-permission-single-source-'));
  temps.push(dir);
  mkdirSync(join(dir, 'app', 'src'), { recursive: true });
  mkdirSync(join(dir, 'packages', 'infra', 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'packages', 'infra', 'src', 'index.ts'),
    'export {};\n'
  );
  const target = join(dir, ...relPath.split('/'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, dupSource);
  return dir;
}

/**
 * 多文件夹具：`files` = 相对仓库根的路径 → 内容（用于 ⑤ 的 BashTool/门禁双文件联动）。
 * 仍建 `packages/infra/src/index.ts` 占位以满足"扫描到源文件"。
 */
function fixtureFiles(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'liri-permission-single-source-'));
  temps.push(dir);
  mkdirSync(join(dir, 'app', 'src'), { recursive: true });
  mkdirSync(join(dir, 'packages', 'infra', 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'packages', 'infra', 'src', 'index.ts'),
    'export {};\n'
  );
  for (const [relPath, content] of Object.entries(files)) {
    const target = join(dir, ...relPath.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return dir;
}

function run(projectDir?: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      ...(projectDir ? { PYAPP_PROJECT_DIR: projectDir } : {}),
    },
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('lint:permission-single-source', () => {
  it('真实仓库：危险表 / 只读目录各仅一份', () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.out).toContain('各仅一份');
  });

  it('负向对照：第二份只读命令目录 ⇒ exit 1 并点名', () => {
    const dir = fixture(`
export const READ_ONLY_BASES = new Set(['ls', 'cat', 'head', 'tail', 'grep', 'find', 'wc']);
`);
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.out).toContain('app/src/dup.ts');
    expect(r.out).toContain('已废弃常量');
  });

  it('负向对照：第二份危险命令表 ⇒ exit 1 并点名', () => {
    const dir = fixture(`
const danger = new Set(['rm -rf', 'mkfs', 'dd if=', 'chmod 777']);
`);
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.out).toContain('疑似第二份危险命令表');
  });

  it('引用式别名不算第二份（exit 0）', () => {
    const dir = fixture(`
import { READ_ONLY_BASE_COMMANDS } from '@openliri/infra/security';
const READ_ONLY_BASES = READ_ONLY_BASE_COMMANDS;
`);
    const r = run(dir);
    expect(r.status).toBe(0);
  });

  it('扫描目录缺失 ⇒ exit 1（不得静默通过）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'liri-permission-single-source-'));
    temps.push(dir);
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.out).toContain('扫描目录缺失');
  });

  it('负向对照：HTTP 层出现 tool_rules.json ⇒ exit 1（规则库路径只属于 RuleManager）', () => {
    const dir = fixture(
      `const path = 'tool_rules.json';\nexport default path;\n`,
      'app/src/infrastructure/http/handlers/other.ts'
    );
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.out).toContain('HTTP 层不得出现');
    expect(r.out).toContain('other.ts');
  });

  it('负向对照：第二个 handler 注册 /v1/permissions/rules ⇒ exit 1 并点名', () => {
    const dir = fixture(
      `export function isRulesRoute(url: string) {\n  return url === '/v1/permissions/rules';\n}\n`,
      'app/src/infrastructure/http/handlers/other.ts'
    );
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.out).toContain('注册了工具规则写路径');
    expect(r.out).toContain('other.ts');
  });

  it('唯一写入口文件里出现同一路由 ⇒ exit 0（不误报实现体）', () => {
    const dir = fixture(
      `export function isRulesRoute(url: string) {\n  return url === '/v1/permissions/rules';\n}\n`,
      'app/src/infrastructure/http/handlers/permission-handlers.ts'
    );
    const r = run(dir);
    expect(r.status).toBe(0);
  });

  // ─── ⑥ 权限运行时实例唯一（2026-11-26）────────────────────────────────────

  it('负向对照：生产代码另起权限运行时实例 ⇒ exit 1 并点名', () => {
    const dir = fixture(
      `import { createPermissionManager } from '@openliri/infra/permission';\nexport const pm = createPermissionManager();\n`
    );
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.out).toContain('app/src/dup.ts');
    expect(r.out).toContain('另起权限运行时');
  });

  it('注释 / 报错文案里提到工厂名不算调用（exit 0）', () => {
    const dir = fixture(
      `// 如需独立实例可 createPermissionManager()\nexport const msg = '请用 createPermissionManager() 注入';\n`
    );
    const r = run(dir);
    expect(r.status).toBe(0);
  });

  it('工厂定义文件自身不误报（exit 0）', () => {
    const dir = fixture(
      `export function createPermissionManager() {\n  return {};\n}\n`,
      'packages/infra/src/permission/PermissionManager.ts'
    );
    const r = run(dir);
    expect(r.status).toBe(0);
  });

  // ─── ⑤ 审批可执行性契约（2026-11-24）────────────────────────────────────────
  it('负向对照：bash 工具新增未登记的 requireApproval 出口 ⇒ exit 1 并点名', () => {
    const dir = fixture(
      `export const ask = { requireApproval: true };\n`,
      'app/src/tools/bash/NewAsk.ts'
    );
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.out).toContain('NewAsk.ts');
    expect(r.out).toContain('未登记审批终局预检');
  });

  it('负向对照：BashTool 丢掉审批终局预检引用 ⇒ exit 1', () => {
    const dir = fixture(
      `export const execute = () => null;\n`,
      'app/src/tools/bash/BashTool.ts'
    );
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.out).toContain('BashTool.ts');
    expect(r.out).toContain('审批终局预检');
  });

  it('负向对照：预检未委托 checkWhitelistAndSandbox ⇒ exit 1（预检与真实路径必须同源）', () => {
    const dir = fixtureFiles({
      'app/src/tools/bash/bashSecurityGate.ts': [
        'export const ask = { requireApproval: true };',
        'export function checkApprovalWouldBeBlocked() {',
        '  return null;',
        '}',
        '',
      ].join('\n'),
    });
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.out).toContain('必须委托 checkWhitelistAndSandbox');
  });

  it('合法形态：ask 出口已登记 + 预检委托真实硬拦截 ⇒ exit 0', () => {
    const dir = fixtureFiles({
      'app/src/tools/bash/bashSecurityGate.ts': [
        'export const ask = { requireApproval: true };',
        'export function checkApprovalWouldBeBlocked() {',
        '  return checkWhitelistAndSandbox();',
        '}',
        '',
      ].join('\n'),
      'app/src/tools/bash/BashTool.ts': [
        "import { checkApprovalWouldBeBlocked } from './bashSecurityGate';",
        'export class BashTool {',
        '  private runSecurityGates(params: { skipAskByPolicy: (b: unknown) => boolean }): string | null {',
        '    void checkApprovalWouldBeBlocked;',
        '    void params;',
        '    const a = checkPathSafety(std);',
        '    const b = checkBashDangerousCommand(cmd);',
        '    const c = checkAstAndAnalyzer({});',
        '    const d = checkPowerShellWrapper(cmd, cwd, t);',
        '    if (a || b || c || d) return a ?? b ?? c ?? d;',
        '    const w = checkWhitelistAndSandbox();',
        '    if (w) return w;',
        '    return null;',
        '  }',
        '}',
        '',
      ].join('\n'),
    });
    const r = run(dir);
    expect(r.status).toBe(0);
  });

  // ─── ⑦ deny 必须先于 allowlist（2026-11-27，二次复查 §13.4 ②）─────────────

  /** ⑦ 的 BashTool 夹具：`denyCalls` 逐条放在白名单**之前**（顺序由调用方决定） */
  const bashToolWith = (denyCalls: string[], allowFirst = false): string =>
    [
      "import { checkApprovalWouldBeBlocked } from './bashSecurityGate';",
      'export class BashTool {',
      '  private runSecurityGates(params: { skipAskByPolicy: (b: unknown) => boolean }): string | null {',
      '    void checkApprovalWouldBeBlocked;',
      '    void params;',
      ...(allowFirst ? ['    const w = checkWhitelistAndSandbox();'] : []),
      ...denyCalls.map((call, i) => `    const d${i} = ${call};`),
      ...(allowFirst ? [] : ['    const w = checkWhitelistAndSandbox();']),
      '    if (w) return w;',
      '    return null;',
      '  }',
      '}',
      '',
    ].join('\n');

  const FULL_DENY = [
    'checkPathSafety(std)',
    'checkBashDangerousCommand(cmd)',
    'checkAstAndAnalyzer({})',
    'checkPowerShellWrapper(cmd, cwd, t)',
  ];

  it('合法形态：4 道 deny 门都在白名单之前 ⇒ exit 0', () => {
    const dir = fixtureFiles({
      'app/src/tools/bash/BashTool.ts': bashToolWith(FULL_DENY),
    });
    expect(run(dir).status).toBe(0);
  });

  it('负向对照：白名单被挪到 deny 之前 ⇒ exit 1 并点名顺序', () => {
    const dir = fixtureFiles({
      'app/src/tools/bash/BashTool.ts': bashToolWith(FULL_DENY, true),
    });
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.out).toContain('deny 必须先于 allowlist');
    expect(r.out).toContain('checkAstAndAnalyzer');
  });

  it('负向对照：缺少某道 deny 门 ⇒ exit 1（顺序不可验证，fail-closed）', () => {
    const dir = fixtureFiles({
      'app/src/tools/bash/BashTool.ts': bashToolWith(
        FULL_DENY.filter((c) => !c.startsWith('checkBashDangerousCommand'))
      ),
    });
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.out).toContain('缺少 checkBashDangerousCommand');
  });

  it('负向对照：定位不到 runSecurityGates ⇒ exit 1（不得静默通过）', () => {
    const dir = fixtureFiles({
      'app/src/tools/bash/BashTool.ts':
        "import { checkApprovalWouldBeBlocked } from './bashSecurityGate';\nexport const run = () => checkApprovalWouldBeBlocked();\n",
    });
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.out).toContain('定位不到 runSecurityGates');
  });
});
