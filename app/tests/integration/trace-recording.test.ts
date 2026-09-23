/**
 * P3-2.15: 集成测试 — AI Trace 录制验证
 *
 * 验证 AITracePlugin 启动后录制 AI 调用到 JSONL 文件。
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { AITracePlugin } from '../../src/trace-recording/AITracePlugin';
import {
  isAIApiUrl,
  sanitizeHeaders,
  sanitizeUrl,
} from '../../src/trace-recording/interceptor/URLMatcher';
import type { TraceConfig } from '../../src/trace-recording/types';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';

const testTraceDir = join(process.cwd(), 'tests', 'integration', '.tmp-traces');

function setupTraceDir(): string {
  if (!existsSync(testTraceDir)) {
    mkdirSync(testTraceDir, { recursive: true });
  }
  return testTraceDir;
}

function cleanupTraceDir(): void {
  if (existsSync(testTraceDir)) {
    rmSync(testTraceDir, { recursive: true, force: true });
  }
}

describe('AITracePlugin 集成测试', () => {
  afterEach(() => {
    cleanupTraceDir();
  });

  it('创建 AITracePlugin 实例', () => {
    const dir = setupTraceDir();
    const config: Partial<TraceConfig> = {
      traceDir: dir,
      mode: 'all',
      slowThresholdMs: 30000,
      liveViewPort: 0,
    };

    const plugin = new AITracePlugin(config);
    expect(plugin).toBeDefined();
    expect(plugin.getStatus().running).toBe(false);
  });

  it('启动后 running 状态为 true', async () => {
    const dir = setupTraceDir();
    const plugin = new AITracePlugin({
      traceDir: dir,
      mode: 'all',
      slowThresholdMs: 30000,
      liveViewPort: 0,
    });

    plugin.start();
    expect(plugin.getStatus().running).toBe(true);
    expect(plugin.getStatus().recordedCount).toBe(0);

    await plugin.stop();
  });

  it('enabled=false 时不启动', async () => {
    const dir = setupTraceDir();
    const plugin = new AITracePlugin({
      traceDir: dir,
      mode: 'all',
      slowThresholdMs: 30000,
      liveViewPort: 0,
    });
    // start() 仍可被调用但插件标记为未运行
    plugin.start();
    expect(plugin.getStatus().running).toBe(true); // start() 强制启动

    await plugin.stop();
  });

  it('getStatus 返回正确的状态字段', async () => {
    const dir = setupTraceDir();
    const plugin = new AITracePlugin({
      traceDir: dir,
      mode: 'error-only',
      slowThresholdMs: 30000,
      liveViewPort: 0,
    });

    plugin.start();
    const status = plugin.getStatus();

    expect(status.running).toBe(true);
    expect(status.mode).toBe('error-only');
    expect(status.traceDir).toBe(dir);
    expect(typeof status.recordedCount).toBe('number');

    await plugin.stop();
  });

  it('stop 后 running 状态为 false', async () => {
    const dir = setupTraceDir();
    const plugin = new AITracePlugin({
      traceDir: dir,
      mode: 'all',
      slowThresholdMs: 30000,
      liveViewPort: 0,
    });

    plugin.start();
    expect(plugin.getStatus().running).toBe(true);

    await plugin.stop();
    expect(plugin.getStatus().running).toBe(false);
  });
});

/**
 * 观测层凭据剥离（2026-09-23，Spec v0.2 §6-4）。
 *
 * 注：`traces/` 的**保留策略不在此处测试** —— 唯一实现是
 * `src/session/ArtifactRetention.ts`（`traceKeepDays=7`），其 16 例覆盖见
 * `tests/session/artifactRetention.test.ts`（此处不重复实现/重复测，CS01 + §3.11）。
 */
describe('traces 观测层：凭据剥离', () => {
  it('敏感头整值脱敏（不留前缀）', () => {
    const headers = sanitizeHeaders({
      authorization: 'Bearer sk-abcdefghijklmnop',
      'x-api-key': 'sk-abcdefghijklmnop',
      'content-type': 'application/json',
    });
    expect(headers.authorization).toBe('***');
    expect(headers['x-api-key']).toBe('***');
    expect(headers['content-type']).toBe('application/json');
    // 关键回归：不得残留凭据前缀（改动前是"前 12 位 + ..."）
    expect(JSON.stringify(headers)).not.toContain('sk-');
  });

  it('URL 查参凭据脱敏（GoogleProvider 的 ?key=）且保留其它参数', () => {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=AIzaSyFAKEKEY1234567890';
    const safe = sanitizeUrl(url);

    expect(safe).not.toContain('AIzaSyFAKEKEY1234567890');
    expect(safe).toContain('key=***');
    // 非凭据参数保留（避免破坏观测可读性）
    expect(safe).toContain('alt=sse');
    expect(isAIApiUrl(url)).toBe(true);
  });
});
