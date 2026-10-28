// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * LRO-07（2026-10-26）：规则来源不得伪造 + 拒绝必须给出**解除入口**。
 *
 * 实测（`dev_docs/20261026/证据/`）：`tool_rules.json` 里的规则全被标成 `userSettings`
 * —— 那是 `createPermissionRule()` 的默认值，而磁盘上根本没有 settings.json；
 * deny 文案因此写 `Denied by rule from userSettings`，用户按提示找不到、模型也不知道
 * 怎么解除（`file_write` 连续 6 次全被拒，元数据里连 ruleId 都没有）。
 *
 * 隔离：`setUserDataDirOverride()` 把 `resolvePermissionsDir()` 指到临时目录，
 * 不碰真实 `~/.pyapp/data/permissions/tool_rules.json`。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  setUserDataDirOverride,
  getUserDataDirOverride,
  resolvePermissionsDir,
} from '@modules/environment';

import { RuleManager } from '../../src/permission/RuleManager.js';
import { PermissionManager } from '../../src/permission/PermissionManager.js';
import {
  PermissionBehavior,
  PermissionRuleSource,
} from '../../src/permission/types/PermissionRule.js';

const LEGACY_RULE_ID = 'rule_legacy_1';

let baseDir: string;
let prevOverride: string | null;
let ruleFile: string;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'liri-lro07-'));
  prevOverride = getUserDataDirOverride();
  setUserDataDirOverride(baseDir);
  ruleFile = join(resolvePermissionsDir(), 'tool_rules.json');
});

afterEach(() => {
  setUserDataDirOverride(prevOverride);
  // **不删除**临时数据目录：若有 DB/文件单例在其上缓存了路径，删除会让**后续测试文件**
  // 落到已消失的库上（同类隐患已在 CI macOS 以 `SQLiteError: disk I/O error` 现形）。
  // 临时目录由 OS 清理。
});

/** 历史数据形态：规则库文件里的规则被标成 `userSettings` */
function writeLegacyRules(): void {
  mkdirSync(dirname(ruleFile), { recursive: true });
  writeFileSync(
    ruleFile,
    JSON.stringify(
      [
        {
          id: LEGACY_RULE_ID,
          behavior: 'deny',
          toolName: 'file_write',
          source: 'userSettings',
          priority: 1,
          createdAt: '2026-10-25T20:00:00.000Z',
          updatedAt: '2026-10-25T20:00:00.000Z',
        },
      ],
      null,
      2
    ),
    'utf8'
  );
}

function readPersistedRules(): Array<{ id: string; source: string }> {
  return JSON.parse(readFileSync(ruleFile, 'utf8')) as Array<{
    id: string;
    source: string;
  }>;
}

describe('LRO-07：规则库来源不再伪造成 userSettings', () => {
  it('旧数据加载即迁移为 ruleStore，并回写磁盘（一次性，幂等）', () => {
    writeLegacyRules();

    const rm = new RuleManager();
    const rules = rm.loadRules();

    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe(PermissionRuleSource.RULE_STORE);
    expect(readPersistedRules()[0].source).toBe('ruleStore');
  });

  it('迁移后再次加载不再改动（已迁移数据保持 ruleStore）', () => {
    writeLegacyRules();
    new RuleManager().loadRules();

    const rm = new RuleManager();
    const rules = rm.loadRules();

    expect(rules[0].source).toBe(PermissionRuleSource.RULE_STORE);
    expect(readPersistedRules()[0].source).toBe('ruleStore');
  });

  it('新增规则落盘来源即 ruleStore（不靠"下次启动再迁移"）', () => {
    const pm = new PermissionManager();
    pm.addRule(PermissionBehavior.DENY, 'bash');

    const persisted = readPersistedRules();
    expect(persisted).toHaveLength(1);
    expect(persisted[0].source).toBe('ruleStore');
  });
});

describe('LRO-07：规则拒绝给出可执行的解除入口', () => {
  it('deny 文案：真实来源 ruleStore + ruleId + 面板/API 两条解除路径', async () => {
    writeLegacyRules();

    const pm = new PermissionManager();
    const result = await pm.checkPermissionForTool(
      'file_write',
      { file_path: 'a.txt' },
      { sessionId: 's-lro07' }
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Denied by rule');
    // 来源必须如实（不再伪造成 userSettings）
    expect(result.reason).toContain('from ruleStore');
    expect(result.reason).not.toContain('userSettings');
    // 可定位到具体规则
    expect(result.reason).toContain(`[rule=${LEGACY_RULE_ID}]`);
    // 可解除：面板 + 精确的 API 路径（带上同一个 ruleId）
    expect(result.reason).toContain('工具权限规则');
    expect(result.reason).toContain(
      `DELETE /v1/permissions/rules/${LEGACY_RULE_ID}`
    );
  });

  it('denyInfo 结构化回传（此前只存在 decision.context，归一化时被截断）', async () => {
    writeLegacyRules();

    const pm = new PermissionManager();
    const result = await pm.checkPermissionForTool(
      'file_write',
      { file_path: 'a.txt' },
      { sessionId: 's-lro07' }
    );

    expect(result.denyInfo).toEqual({
      ruleId: LEGACY_RULE_ID,
      sourceKind: 'ruleStore',
      removableVia: `在「设置 → 权限管理 → 工具权限规则」删除该规则，或 DELETE /v1/permissions/rules/${LEGACY_RULE_ID}`,
      // F5：该规则**不含** inputFingerprint ⇒ 工具级命中（能据此判断"是不是整工具被拦"）
      matchScope: 'tool',
    });
  });

  it('F5：带 inputFingerprint 的 deny 规则**不匹配**其它参数（不再是工具级笼罩）', async () => {
    mkdirSync(dirname(ruleFile), { recursive: true });
    writeFileSync(
      ruleFile,
      JSON.stringify(
        [
          {
            id: 'rule_fp_1',
            behavior: 'deny',
            toolName: 'file_write',
            // 与本次调用无关的指纹 ⇒ 必须不命中
            inputFingerprint: 'deadbeefdeadbeefdeadbeefdeadbeef',
            source: 'ruleStore',
            priority: 1,
            createdAt: '2026-10-26T14:02:41.496Z',
            updatedAt: '2026-10-26T14:02:41.496Z',
          },
        ],
        null,
        2
      ),
      'utf8'
    );

    const pm = new PermissionManager();
    const result = await pm.checkPermissionForTool(
      'file_write',
      { file_path: 'probe.txt' },
      { sessionId: 's-f5' }
    );

    expect(result.reason).not.toContain('Denied by rule');
    expect(result.denyInfo).toBeUndefined();
  });
});
