// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P3-2（复杂度清理）：`mergeWithDefault`（startup.yaml → 默认配置合并）的特征化锁。
 *
 * 现状：启动配置合并没有任何回归锁。该方法按 section 把 YAML 覆盖到默认配置上，
 * 外移各 section 时最容易改坏的是「类型守卫」与「未提供的 section 保持默认」。
 *
 * 手法：把 `LIRI_PROJECT_DIR` 指向临时目录并写入 startup.yaml，走 `loadStartupConfig()`
 * 真实链路（含自研 YAML 解析），断言各 section 的合并结果与未覆盖处的默认值。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'startup-yaml-'));
const prevProjectDir = process.env.LIRI_PROJECT_DIR;
process.env.LIRI_PROJECT_DIR = dir;

const STARTUP_YAML = `version: 2
mode: daemon
debug: true
verbose: true
modules:
  enabled:
    - mod_a
  disabled:
    - mod_b
plugins:
  autoLoad: false
  allowedSources:
    - local
  blacklist:
    - bad_plugin
gateway:
  enabledChannels:
    - cli
  disabledChannels:
    - http
  websocket:
    enabled: true
    port: 9090
ai:
  provider: test-provider
  model: test-model
  baseUrl: http://127.0.0.1:1
features:
  autoCompact: false
  telemetry: true
  fileCheckpointing: false
  terminalProgressBar: true
performance:
  startupTimeoutMs: 1234
security:
  sandboxIsolation: strict
  mtlsEnabled: true
`;

writeFileSync(join(dir, 'startup.yaml'), STARTUP_YAML, 'utf8');

const { loadStartupConfig } =
  await import('../../src/bootstrap/StartupYamlLoader.js');
const { DEFAULT_STARTUP_CONFIG } =
  await import('../../src/bootstrap/StartupConfig.js');

afterAll(() => {
  if (prevProjectDir === undefined) delete process.env.LIRI_PROJECT_DIR;
  else process.env.LIRI_PROJECT_DIR = prevProjectDir;
  rmSync(dir, { recursive: true, force: true });
});

describe('startup.yaml 合并默认配置（P3-2 外移前特征化）', () => {
  const result = loadStartupConfig();

  it('能找到文件且无解析/校验错误', () => {
    expect(result.found).toBe(true);
    expect(result.sourcePath).toContain('startup.yaml');
    expect(result.parseErrors).toEqual([]);
  });

  it('顶层标量逐项覆盖', () => {
    expect(result.config.version).toBe(2);
    expect(result.config.mode).toBe('daemon');
    expect(result.config.debug).toBe(true);
    expect(result.config.verbose).toBe(true);
  });

  it('modules / plugins / gateway（含嵌套 websocket）逐项覆盖', () => {
    expect(result.config.modules?.enabled).toEqual(['mod_a']);
    expect(result.config.modules?.disabled).toEqual(['mod_b']);

    expect(result.config.plugins?.autoLoad).toBe(false);
    expect(result.config.plugins?.allowedSources).toEqual(['local']);
    expect(result.config.plugins?.blacklist).toEqual(['bad_plugin']);

    expect(result.config.gateway?.enabledChannels).toEqual(['cli']);
    expect(result.config.gateway?.disabledChannels).toEqual(['http']);
    expect(result.config.gateway?.websocket?.enabled).toBe(true);
    expect(result.config.gateway?.websocket?.port).toBe(9090);
  });

  it('ai / features / performance / security 逐项覆盖', () => {
    expect(result.config.ai?.provider).toBe('test-provider');
    expect(result.config.ai?.model).toBe('test-model');
    expect(result.config.ai?.baseUrl).toBe('http://127.0.0.1:1');

    expect(result.config.features?.autoCompact).toBe(false);
    expect(result.config.features?.telemetry).toBe(true);
    expect(result.config.features?.fileCheckpointing).toBe(false);
    expect(result.config.features?.terminalProgressBar).toBe(true);

    expect(result.config.performance?.startupTimeoutMs).toBe(1234);

    expect(result.config.security?.sandboxIsolation).toBe('strict');
    expect(result.config.security?.mtlsEnabled).toBe(true);
  });

  it('负向对照：YAML 未提供的字段保持默认（合并只覆盖出现项）', () => {
    expect(result.config.performance?.deferredPrefetch).toBe(
      DEFAULT_STARTUP_CONFIG.performance?.deferredPrefetch
    );
    expect(result.config.security?.permissionLevel).toBe(
      DEFAULT_STARTUP_CONFIG.security?.permissionLevel
    );
  });
});
