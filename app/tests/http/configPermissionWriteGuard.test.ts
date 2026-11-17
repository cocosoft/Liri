// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * R1（2026-11-17）：`permission` 配置段的**写入口守卫**。
 *
 * 工具规则（A 体系）唯一写入口 = `/v1/permissions/rules`（`tool_rules.json`）；
 * `PUT /v1/config/permission` 只承载 B 体系命令黑白名单 / 受信任工作区 / 信任档。
 * 本用例锁两件事：
 * 1. 正常 B 体系配置**不被误伤**（命令规则/信任工作区字段名不得触发拒绝）；
 * 2. 混入工具规则字段 ⇒ 400 且指回唯一入口（不静默落库成第二套存储）。
 */
import { describe, expect, it } from 'bun:test';
import type http from 'http';

import { findToolRuleField } from '../../src/infrastructure/http/handlers/config-permission-guard';
import { handleSetConfig } from '../../src/infrastructure/http/handlers/config-handlers';
import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';

/** 正常 B 体系 + 信任配置（两个面板真实写入的形状） */
const LEGIT_PERMISSION_CONFIG = {
  mode: 'default',
  defaultTrustLevel: 'chat',
  trustedWorkspaces: [{ path: 'E:/work/demo', level: 'development' }],
  customRules: {
    commandRules: {
      mode: 'blacklist',
      blacklist: [{ pattern: 'rm -rf', matchType: 'prefix' }],
      whitelist: [{ pattern: 'git status', matchType: 'prefix' }],
    },
    directoryRules: { whitelist: [], blacklist: [{ path: '/etc' }] },
  },
};

function captureRes(): {
  res: http.ServerResponse;
  captured: { status: number; body: string };
} {
  const captured = { status: 0, body: '' };
  const res = {
    writeHead(status: number) {
      captured.status = status;
    },
    end(body?: string) {
      captured.body = body ?? '';
    },
  } as unknown as http.ServerResponse;
  return { res, captured };
}

describe('R1：permission 配置段写入口守卫（纯函数）', () => {
  it('B 体系命令规则 / 受信任工作区 / 信任档 ⇒ 不命中（不误伤）', () => {
    expect(findToolRuleField(LEGIT_PERMISSION_CONFIG)).toBeNull();
  });

  it('工具规则字段（含嵌套数组）⇒ 命中并给出字段路径', () => {
    expect(
      findToolRuleField({
        customRules: {
          commandRules: {
            blacklist: [{ pattern: 'rm', contentPattern: '^rm ' }],
          },
        },
      })
    ).toEqual({
      field: 'contentPattern',
      path: 'customRules.commandRules.blacklist[0].contentPattern',
    });

    expect(findToolRuleField({ rules: [{ inputFingerprint: 'abc' }] })).toEqual(
      { field: 'inputFingerprint', path: 'rules[0].inputFingerprint' }
    );
    expect(
      findToolRuleField({ trustedWorkspaces: [{ workspaceRoot: 'E:/' }] })
    ).toEqual({
      field: 'workspaceRoot',
      path: 'trustedWorkspaces[0].workspaceRoot',
    });
    expect(
      findToolRuleField({ tools: [{ toolName: 'bash', behavior: 'allow' }] })
    ).toEqual({ field: 'behavior', path: 'tools[0].behavior' });
  });

  it('标量 / null 等非对象值 ⇒ 不命中（不抛错）', () => {
    expect(findToolRuleField(null)).toBeNull();
    expect(findToolRuleField('tool_rules')).toBeNull();
    expect(findToolRuleField(42)).toBeNull();
  });
});

describe('R1：PUT /v1/config/permission 的拒绝路径', () => {
  it('混入工具规则字段 ⇒ 400 + writeEntry 指回 /v1/permissions/rules', async () => {
    const ctx = {
      readRequestBody: async () =>
        JSON.stringify({
          value: {
            customRules: {
              commandRules: { blacklist: [{ contentPattern: '^rm ' }] },
            },
          },
        }),
    } as unknown as HandlerCtx;
    const { res, captured } = captureRes();

    await handleSetConfig(ctx, {} as http.IncomingMessage, res, 'permission');

    expect(captured.status).toBe(400);
    const body = JSON.parse(captured.body) as {
      error: { field: string; path: string; writeEntry: string };
    };
    expect(body.error.field).toBe('contentPattern');
    expect(body.error.path).toBe(
      'customRules.commandRules.blacklist[0].contentPattern'
    );
    expect(body.error.writeEntry).toBe('/v1/permissions/rules');
  });
});
