/**
 * P2-1 迁移器 CLI 自证（2026-11-03）。
 *
 * 钉死方案 §7 的风险约束：
 *   ① 默认 dry-run **不写盘**；
 *   ② `--migrate` 先备份 `tool_rules.json` 再写统一快照，且**不改来源文件**；
 *   ③ 来源 JSON 解析失败 ⇒ exit 1（不得静默迁移成半份规则）。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = join(process.cwd(), '..');
const SCRIPT = join(REPO_ROOT, 'app', 'scripts', 'migrate-permission-rules.ts');

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

function fixture(rulesJson: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'liri-migrate-rules-'));
  temps.push(dir);
  const permissionsDir = join(dir, 'permissions');
  mkdirSync(permissionsDir, { recursive: true });
  writeFileSync(join(permissionsDir, 'tool_rules.json'), rulesJson);
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({
      permission: {
        customRules: {
          commandRules: {
            blacklist: [{ pattern: 'rm -rf' }],
            whitelist: [],
            mode: 'blacklist',
          },
        },
      },
    })
  );
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({ permissions: { allow: ['Read'], deny: ['Bash(rm:*)'] } })
  );
  return dir;
}

function run(
  dir: string,
  extra: string[] = []
): { status: number | null; out: string } {
  const r = spawnSync(
    process.execPath,
    [
      SCRIPT,
      '--permissions-dir',
      join(dir, 'permissions'),
      '--config-file',
      join(dir, 'config.json'),
      '--user-settings',
      join(dir, 'settings.json'),
      '--project-settings',
      join(dir, 'none-project.json'),
      '--local-settings',
      join(dir, 'none-local.json'),
      ...extra,
    ],
    { encoding: 'utf-8' }
  );
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const validRules = JSON.stringify([
  {
    id: 'r1',
    behavior: 'allow',
    toolName: 'bash',
    contentPattern: 'npm run test:*',
    source: 'ruleStore',
    priority: 1,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  },
]);

describe('migrate-permission-rules', () => {
  it('默认 dry-run：合并四来源但**不写盘**', () => {
    const dir = fixture(validRules);
    const r = run(dir);
    expect(r.status).toBe(0);
    expect(r.out).toContain('dry-run');
    expect(existsSync(join(dir, 'permissions', 'unified_rules.json'))).toBe(
      false
    );
  });

  it('--migrate：备份 tool_rules.json 后写快照，来源文件不变', () => {
    const dir = fixture(validRules);
    const r = run(dir, ['--migrate']);
    expect(r.status).toBe(0);
    const snapshot = join(dir, 'permissions', 'unified_rules.json');
    expect(existsSync(snapshot)).toBe(true);
    const backups = readdirSync(join(dir, 'permissions')).filter((f) =>
      f.startsWith('tool_rules.json.bak-')
    );
    expect(backups.length).toBe(1);
    expect(
      readFileSync(join(dir, 'permissions', 'tool_rules.json'), 'utf-8')
    ).toBe(validRules);
    const parsed = JSON.parse(readFileSync(snapshot, 'utf-8')) as {
      rules: unknown[];
    };
    expect(parsed.rules.length).toBeGreaterThan(0);
  });

  it('来源 JSON 解析失败 ⇒ exit 1（不得静默迁移）', () => {
    const dir = fixture('{ not json');
    const r = run(dir, ['--migrate']);
    expect(r.status).toBe(1);
    expect(r.out).toContain('无法解析');
  });
});
