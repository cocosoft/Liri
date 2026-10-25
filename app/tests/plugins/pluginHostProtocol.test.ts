// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T25-08 P1（2026-10-25）：第三方插件子进程宿主 —— 协议面 / env 白名单 / 入口纯函数。
//
// 覆盖 spec `.trae/specs/plugin-process-isolation.md` §6 的 P1 验收第 ① 条：
// 插件读 `process.env` **拿不到**宿主密钥 —— 其根在 `buildPluginHostEnv` 的白名单。
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parentPidEnvKey } from '../../src/utils/parentLiveness';
import {
  PLUGIN_HOST_ENV_DIR,
  PLUGIN_HOST_ENV_ENTRY,
  PLUGIN_HOST_ENV_ID,
  PLUGIN_HOST_EVENT,
  buildPluginHostEnv,
  parsePluginLog,
  parseStartFailed,
  parseToolDeclarations,
  readPluginHostTarget,
} from '../../src/plugins/host/pluginHostProtocol';
import {
  collectTools,
  resolvePluginObject,
} from '../../src/plugins/host/pluginHostEntry';

describe('T25-08 P1 · env 白名单（宿主密钥不外泄）', () => {
  it('宿主 .env 里的密钥不进入子进程 env', () => {
    const env = buildPluginHostEnv(
      {
        PATH: '/usr/bin',
        HOME: '/home/u',
        SystemRoot: 'C:\\Windows',
        OPENAI_API_KEY: 'sk-secret',
        LIRI_HTTP_TOKEN: 'tok',
        AWS_SECRET_ACCESS_KEY: 'aws',
      },
      {
        pluginId: 'p1',
        pluginDir: '/plugins/p1',
        entryPath: '/plugins/p1/i.js',
      }
    );

    expect(env['OPENAI_API_KEY']).toBeUndefined();
    expect(env['LIRI_HTTP_TOKEN']).toBeUndefined();
    expect(env['AWS_SECRET_ACCESS_KEY']).toBeUndefined();
    expect(JSON.stringify(env)).not.toContain('sk-secret');
  });

  it('保留运行所需的最小集 + 注入插件目标 + 父 PID', () => {
    const env = buildPluginHostEnv(
      { PATH: '/usr/bin', HOME: '/home/u', SystemRoot: 'C:\\Windows' },
      {
        pluginId: 'p1',
        pluginDir: '/plugins/p1',
        entryPath: '/plugins/p1/i.js',
        parentPid: 4242,
      }
    );

    expect(env['PATH']).toBe('/usr/bin');
    expect(env['HOME']).toBe('/home/u');
    expect(env['SystemRoot']).toBe('C:\\Windows');
    expect(env[PLUGIN_HOST_ENV_ID]).toBe('p1');
    expect(env[PLUGIN_HOST_ENV_DIR]).toBe('/plugins/p1');
    expect(env[PLUGIN_HOST_ENV_ENTRY]).toBe('/plugins/p1/i.js');
    expect(env[parentPidEnvKey()]).toBe('4242');
  });

  it('空值键不写入（不制造空 env）', () => {
    const env = buildPluginHostEnv(
      { PATH: '', HOME: '/home/u' },
      { pluginId: 'p1', pluginDir: '/d', entryPath: '/d/i.js' }
    );
    expect('PATH' in env).toBe(false);
  });

  it('readPluginHostTarget：缺任一项 ⇒ null（子进程 fail-closed）', () => {
    const full = {
      [PLUGIN_HOST_ENV_ID]: 'p1',
      [PLUGIN_HOST_ENV_DIR]: '/d',
      [PLUGIN_HOST_ENV_ENTRY]: '/d/i.js',
    };
    expect(readPluginHostTarget(full)).toEqual({
      pluginId: 'p1',
      pluginDir: '/d',
      entryPath: '/d/i.js',
    });
    expect(
      readPluginHostTarget({ ...full, [PLUGIN_HOST_ENV_ENTRY]: '' })
    ).toBeNull();
    expect(readPluginHostTarget({})).toBeNull();
  });
});

describe('T25-08 P1 · 工具声明解析（不臆造）', () => {
  it('合法声明逐项解析', () => {
    const frame = {
      type: 'notify',
      event: PLUGIN_HOST_EVENT.TOOLS_REGISTER,
      data: {
        tools: [
          {
            name: 'a',
            description: 'A',
            parameters: { x: { type: 'string' } },
          },
          { name: 'b' },
        ],
      },
    };
    expect(parseToolDeclarations(frame)).toEqual([
      { name: 'a', description: 'A', parameters: { x: { type: 'string' } } },
      { name: 'b', description: '', parameters: undefined },
    ]);
  });

  it('非 notify / 事件名不符 / 无 tools 数组 ⇒ null', () => {
    expect(parseToolDeclarations({ id: 'x', success: true })).toBeNull();
    expect(
      parseToolDeclarations({
        type: 'notify',
        event: 'other',
        data: { tools: [] },
      })
    ).toBeNull();
    expect(
      parseToolDeclarations({
        type: 'notify',
        event: PLUGIN_HOST_EVENT.TOOLS_REGISTER,
      })
    ).toBeNull();
  });

  it('无 name 的条目被丢弃（不给不存在的工具造代理）', () => {
    const parsed = parseToolDeclarations({
      type: 'notify',
      event: PLUGIN_HOST_EVENT.TOOLS_REGISTER,
      data: {
        tools: [{ description: 'no name' }, { name: '' }, { name: 'ok' }],
      },
    });
    expect(parsed?.map((t) => t.name)).toEqual(['ok']);
  });

  it('日志与启动失败通知：非法形状返回 null / 兜底文案', () => {
    expect(
      parsePluginLog({
        type: 'notify',
        event: PLUGIN_HOST_EVENT.LOG,
        data: { level: 'warn', message: 'hi' },
      })
    ).toEqual({ level: 'warn', message: 'hi' });
    expect(
      parsePluginLog({ type: 'notify', event: PLUGIN_HOST_EVENT.LOG, data: {} })
    ).toBeNull();

    expect(
      parseStartFailed({
        type: 'notify',
        event: PLUGIN_HOST_EVENT.START_FAILED,
        data: { message: 'boom' },
      })
    ).toBe('boom');
    expect(
      parseStartFailed({
        type: 'notify',
        event: PLUGIN_HOST_EVENT.START_FAILED,
        data: {},
      })
    ).toContain('未给出原因');
  });
});

describe('T25-08 P1 · 子进程入口纯函数', () => {
  it('resolvePluginObject：class / object / named plugin / 非法', () => {
    class P {
      name = 'p';
    }
    expect(resolvePluginObject({ default: P })).toBeInstanceOf(P);
    expect(resolvePluginObject({ default: { name: 'o' } })).toEqual({
      name: 'o',
    });
    expect(resolvePluginObject({ plugin: { name: 'n' } })).toEqual({
      name: 'n',
    });
    expect(resolvePluginObject(42)).toBeNull();
  });

  it('collectTools：只收带 execute 的项并按 name 去重', () => {
    const handler = (input: Record<string, unknown>) => ({ got: input });
    const tools = collectTools(
      {
        tools: [
          { name: 'echo', description: 'E', parameters: {}, execute: handler },
          { name: 'echo', description: 'dup', execute: handler },
          { name: 'declared-only', description: 'no handler' },
        ],
      },
      {}
    );
    expect(tools.map((t) => t.declaration.name)).toEqual(['echo']);
    expect(tools[0]!.handler({ a: 1 })).toEqual({ got: { a: 1 } });
  });
});

describe('T25-08 P1 · 接线防回流（源码级）', () => {
  it('PluginLoader：宿主分支在 import(entryPath) 之前，卸载时停宿主', () => {
    const src = readFileSync(
      new URL('../../src/plugins/core/PluginLoader.ts', import.meta.url),
      'utf8'
    );
    const hostBranch = src.indexOf("feature('PLUGIN_HOST_PROCESS')");
    const importCall = src.indexOf('await import(entryPath)');
    expect(hostBranch).toBeGreaterThan(-1);
    expect(importCall).toBeGreaterThan(-1);
    expect(hostBranch).toBeLessThan(importCall);
    expect(src).toContain('plugin.hostProcess?.stop()');
  });
});
