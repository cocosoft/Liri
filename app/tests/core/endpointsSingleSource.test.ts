/**
 * HD-P0-2 —— 端点 / 本机 host **单一真源**防回流守卫（方案 §4.1 A1·A3·A4·A6）。
 *
 * 三层断言：
 *  ① **取值**：常量与收编前的字面量**逐字相等**（同值搬运 ⇒ 运行时行为零变更）；
 *  ② **单一定义点**：三个端点字面量在 `app/src` 下**只允许出现在** `core/endpoints.ts`；
 *  ③ **语义边界**（防「错误合并」与「漏收编」）：
 *     - `core/endpoints.ts` 必须**零 import**（core 只允许依赖 core；不得读配置）；
 *     - A6 各文件不得再出现"绑定 / 回落"形态的 `127.0.0.1`（**只减不增**棘轮）；
 *     - `:8080` 的**不同事实源**（本地推理 provider 预设）**必须保持独立**，
 *       不得被合并进 OAuth 常量（方案 §5 N7：数值相同只是巧合）。
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  LOCAL_HTTP_HOST,
  DEFAULT_OLLAMA_ENDPOINT,
  DEFAULT_OLLAMA_OPENAI_ENDPOINT,
  DEFAULT_WECHAT_BOT_ENDPOINT,
  DEFAULT_OAUTH_LOCAL_BASE_URL,
} from '@modules/core';

const APP = process.cwd(); // `bun test` 于 app 目录运行
const SRC = join(APP, 'src');
/** 内核已物理迁出 `app/src/core` ⇒ 仓库根 `packages/kernel/src/core`（方案 §4-P4） */
const KERNEL = join(APP, '..', 'packages', 'kernel', 'src', 'core');
const ENDPOINTS = join(KERNEL, 'endpoints.ts');
const ENDPOINTS_REL = relative(APP, ENDPOINTS).split('\\').join('/');

function walk(dir: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      walk(join(dir, e.name), out);
    } else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) {
      out.push(join(dir, e.name));
    }
  }
}

/** 返回 `app/src` 下**除 `core/endpoints.ts` 外**命中该正则的 `相对路径:行号` 清单 */
function hitsOutsideEndpoints(re: RegExp): string[] {
  const files: string[] = [];
  walk(SRC, files);
  walk(KERNEL, files);
  const found: string[] = [];
  for (const f of files) {
    const rel = relative(APP, f).split('\\').join('/');
    if (rel === ENDPOINTS_REL) continue;
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (re.test(line)) found.push(`${rel}:${i + 1}  ${line.trim()}`);
    });
  }
  return found;
}

function countMatches(file: string, re: RegExp): number {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => re.test(l)).length;
}

describe('HD-P0-2 端点 / 本机 host 单一真源', () => {
  it('① 取值与收编前字面量逐字相等（同值搬运 ⇒ 零行为变更）', () => {
    expect(LOCAL_HTTP_HOST).toBe('127.0.0.1');
    expect(DEFAULT_OLLAMA_ENDPOINT).toBe('http://localhost:11434');
    expect(DEFAULT_OLLAMA_OPENAI_ENDPOINT).toBe('http://localhost:11434/v1');
    expect(DEFAULT_WECHAT_BOT_ENDPOINT).toBe('http://localhost:7600');
    expect(DEFAULT_OAUTH_LOCAL_BASE_URL).toBe('http://localhost:8080');
    // `/v1` 由 base 派生 ⇒ 改端口只需改一处
    expect(DEFAULT_OLLAMA_OPENAI_ENDPOINT).toBe(
      `${DEFAULT_OLLAMA_ENDPOINT}/v1`
    );
  });

  it('② 单一定义点：三个端点字面量只出现在 core/endpoints.ts', () => {
    // 精确引号匹配 ⇒ 不会误伤 `.../v1` 形式或 `127.0.0.1:11434` 变体
    const q = (s: string) => new RegExp(`(['"\`])${s}\\1`);
    expect(hitsOutsideEndpoints(q('http://localhost:11434'))).toEqual([]);
    expect(hitsOutsideEndpoints(q('http://localhost:11434/v1'))).toEqual([]);
    expect(hitsOutsideEndpoints(q('http://localhost:7600'))).toEqual([]);
  });

  it('②b 语义边界：:8080 的两个事实源不得互相合并', () => {
    const OAUTH_CONST = 'DEFAULT_OAUTH_LOCAL_BASE_URL';
    // A4：两处 OAuth 白名单**均须引用**真源
    for (const rel of [
      'src/constants/oauth.ts',
      'src/system/auth/oauthConfig.ts',
    ]) {
      expect(readFileSync(join(APP, rel), 'utf8')).toContain(OAUTH_CONST);
    }
    // 不同事实源（本地推理 provider 默认 8080）**不得**引用 OAuth 常量（防错误合并）
    for (const rel of [
      'src/ai/ModelManagementBootstrap.ts',
      'src/ai/providers/providerPresetsData.ts',
    ]) {
      expect(readFileSync(join(APP, rel), 'utf8')).not.toContain(OAUTH_CONST);
    }
  });

  it('③a core/endpoints.ts 必须零 import（core 只依赖 core；不读配置）', () => {
    const src = readFileSync(ENDPOINTS, 'utf8');
    expect(src).not.toMatch(/\bfrom\s+['"]/);
    expect(src).not.toMatch(/\brequire\s*\(/);
    // 也不得调用配置读取（防"顺手"接入 configManager）
    expect(src).not.toMatch(/configManager|getConfig|process\.env/);
  });

  it('③b A6 棘轮：各文件 `127.0.0.1` 出现次数只减不增，且均已引用 LOCAL_HTTP_HOST', () => {
    // 期望上限（只减不增）：LocalHTTPService.ts 保留 1 处「本机判定谓词」（非绑定默认值）
    const expectedMax: Record<string, number> = {
      '../packages/kernel/src/core/health/DependencyHealthChecker.ts': 0,
      'src/acp/AcpWebSocketServer.ts': 0,
      'src/cli/ports/index.ts': 0,
      'src/bridge/ModuleBridgeSetup.ts': 0,
      'src/daemon/IPCService.ts': 0,
      'src/evals/sandbox.ts': 0,
      'src/ai/local/llama/registerLlamaCppProvider.ts': 0,
      'src/ai/local/llama/LlamaCppServerManager.ts': 0,
      'src/entrypoints/repl.ts': 0,
      'src/infrastructure/http/LocalHTTPService.ts': 1,
      'src/main.ts': 0,
      'src/system/auth/auth-code-listener.ts': 0,
      'src/infrastructure/http/a2a/discoverySidecar.ts': 0,
    };
    const quoted = /['"]127\.0\.0\.1['"]/;
    const report: string[] = [];
    for (const [rel, max] of Object.entries(expectedMax)) {
      const abs = join(APP, rel);
      const n = countMatches(abs, quoted);
      if (n > max) report.push(`${rel}: ${n} > 上限 ${max}`);
      if (!readFileSync(abs, 'utf8').includes('LOCAL_HTTP_HOST')) {
        report.push(`${rel}: 未引用 LOCAL_HTTP_HOST（是否漏收编？）`);
      }
    }
    expect(report).toEqual([]);
  });
});
