// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * B3 影子台账（2026-11-19）：开关 / 路径 / 记录构造 / 落盘 / 周报汇总。
 *
 * 口径：影子**只记录不改变判定** —— 判定侧由 `modeHandlers` 的既有用例覆盖；
 * 本文件锁"记录得对、默认关、坏行不炸"。
 */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  PERMISSION_SHADOW_COMMAND_PREVIEW,
  isPermissionShadowEnabled,
  recordPermissionShadow,
  resolvePermissionShadowPath,
  toHardDenyShadowRecord,
  toQuotaShadowRecord,
} from '../../../packages/infra/src/permission/permissionShadow';
import { explainDemandHardDeny } from '../../../packages/infra/src/permission/demandHardDeny';
import {
  parsePermissionShadowLines,
  summarizePermissionShadow,
} from '../../../scripts/report-permission-shadow';

const NOW = Date.parse('2026-11-19T10:00:00.000Z');

describe('开关与路径', () => {
  it('默认关；仅显式 true（大小写不敏感）开启', () => {
    delete process.env.PERMISSION_SHADOW;
    expect(isPermissionShadowEnabled()).toBe(false);
    process.env.PERMISSION_SHADOW = 'TRUE';
    expect(isPermissionShadowEnabled()).toBe(true);
    process.env.PERMISSION_SHADOW = '1';
    expect(isPermissionShadowEnabled()).toBe(false);
    delete process.env.PERMISSION_SHADOW;
  });

  it('台账路径落在 <dataDir>/permission/deny-shadow.jsonl', () => {
    const prev = process.env.LIRI_DATA_DIR;
    process.env.LIRI_DATA_DIR = join(tmpdir(), 'perm-shadow-dir');
    try {
      const p = resolvePermissionShadowPath().replace(/\\/g, '/');
      expect(p.endsWith('/permission/deny-shadow.jsonl')).toBe(true);
      expect(p).toContain('perm-shadow-dir');
    } finally {
      if (prev === undefined) delete process.env.LIRI_DATA_DIR;
      else process.env.LIRI_DATA_DIR = prev;
    }
  });
});

describe('记录构造（纯函数）', () => {
  it('硬拒命中：命令预览截断、会话只落 8 位哈希', () => {
    const record = toHardDenyShadowRecord(
      {
        toolName: 'bash',
        command: `runas ${'x'.repeat(500)}`,
        sessionId: 'session_abcdef123456',
        mode: 'default',
        matched: 'runas',
        matchedBy: 'head',
      },
      NOW
    );
    expect(record.kind).toBe('hard_deny_hit');
    expect(record.matchedBy).toBe('head');
    expect(record.matched).toBe('runas');
    expect(record.commandPreview?.length).toBe(
      PERMISSION_SHADOW_COMMAND_PREVIEW
    );
    expect(record.sessionHash).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(record)).not.toContain('session_abcdef123456');
  });

  it('配额命中：保留 count/limit', () => {
    const record = toQuotaShadowRecord(
      { toolName: 'bash', count: 30, limit: 30, mode: 'default' },
      NOW
    );
    expect(record).toMatchObject({
      kind: 'quota_hit',
      count: 30,
      limit: 30,
      at: NOW,
    });
  });
});

describe('落盘', () => {
  it('追加两行 JSONL（目录自动创建）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'perm-shadow-'));
    const file = join(dir, 'nested', 'deny-shadow.jsonl');
    try {
      await recordPermissionShadow(
        toHardDenyShadowRecord({ toolName: 'bash', command: 'runas x' }, NOW),
        { file }
      );
      await recordPermissionShadow(
        toQuotaShadowRecord({ toolName: 'bash', count: 3, limit: 3 }, NOW),
        { file }
      );
      const lines = readFileSync(file, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).kind).toBe('hard_deny_hit');
      expect(JSON.parse(lines[1]).kind).toBe('quota_hit');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('周报汇总', () => {
  it('按类型/天/命中/工具聚合，坏行跳过，since 过滤生效', () => {
    const text = [
      JSON.stringify(
        toHardDenyShadowRecord(
          {
            toolName: 'bash',
            command: 'runas x',
            matched: 'runas',
            matchedBy: 'head',
          },
          NOW
        )
      ),
      JSON.stringify(
        toHardDenyShadowRecord(
          {
            toolName: 'powershell',
            command: 'git push',
            matched: 'git push',
            matchedBy: 'pattern',
          },
          NOW - 2 * 24 * 3600_000
        )
      ),
      JSON.stringify(
        toQuotaShadowRecord({ toolName: 'bash', count: 5, limit: 5 }, NOW)
      ),
      '{bad json',
    ].join('\n');

    const all = summarizePermissionShadow(parsePermissionShadowLines(text), {
      now: NOW,
      top: 5,
    });
    expect(all.total).toBe(3);
    expect(all.byKind).toEqual({ hard_deny_hit: 2, quota_hit: 1 });
    expect(all.topTools[0]).toEqual({ key: 'bash', count: 2 });
    expect(
      all.topMatched.some((m) => m.key === 'head:runas' && m.count === 1)
    ).toBe(true);
    expect(all.quotaLimits[0]).toEqual({ key: 'limit=5', count: 1 });

    const recent = summarizePermissionShadow(parsePermissionShadowLines(text), {
      now: NOW,
      sinceDays: 1,
    });
    expect(recent.total).toBe(2); // 2 天前那条被过滤
  });
});

describe('explainDemandHardDeny（唯一判定实现的解释投影）', () => {
  it('命令头命中与子命令模式命中可区分', () => {
    expect(explainDemandHardDeny('runas /user:a cmd')).toMatchObject({
      hit: true,
      matchedBy: 'head',
      matched: 'runas',
    });
    const pattern = explainDemandHardDeny('git push origin main');
    expect(pattern.hit).toBe(true);
    expect(pattern.matchedBy).toBe('pattern');
    expect(explainDemandHardDeny('dir /b')).toEqual({ hit: false });
  });
});
