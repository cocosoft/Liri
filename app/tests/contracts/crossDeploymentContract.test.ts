/**
 * HD-P0-3 —— **跨部署单元契约常量**（硬编码统一治理方案 §4.2 B1/B2 / §7.2）。
 *
 * **为什么是"契约测试"而不是"合成一处"**：后端（`app/`）、前端（`client/`）与 Tauri 外壳是
 * **不同部署单元**，物理上无法共享同一个模块 ⇒ 治理方式只能是
 * **①契约集中 + ②同值测试比对两侧取值**（改任一侧即变红，消除"人工同步"）。
 *
 * 本文件钉两类事实源：
 * - **B1 默认后端端口**：后端**真源** `core/ports.ts` 的 `DEFAULT_HTTP_PORT`
 *   ⟷ 前端 TS 常量 / 构建配置（vite proxy·playwright webServer）/ Tauri Rust 常量与内联字面量 /
 *   后端 `.env.example` 示例值；
 * - **B2 日限额 SSE 事件名**：后端导出的 `DAILY_BUDGET_SSE_EVENT`
 *   ⟷ 前端组件常量（并断言前端**仅一处**定义）。
 *
 * **不纳入（如实）**：仓库根的**开发期一次性调试脚本**（非任何部署单元的契约）；
 * 端口变更时它们会自然失效，属开发期工具，不纳入门禁以免制造噪音。
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { DEFAULT_HTTP_PORT } from '../../src/core/ports';
import { DAILY_BUDGET_SSE_EVENT } from '../../src/infrastructure/http/handlers/daily-budget-handlers';

/** 仓库根（`app/tests/contracts/` → 上三级） */
const ROOT = join(import.meta.dir, '..', '..', '..');
const CLIENT_SRC = join(ROOT, 'client', 'src');

/**
 * ⚠️ **为什么用"原文匹配"而不是先剥注释**（实测踩中的坑）：朴素的 `//` 剥离会把
 * `http://127.0.0.1:18990` 里的 `//` 当成注释起点 ⇒ 端口被"剥掉"，反而导致**假红**。
 * 因此 ② 类"包含性"断言直接读**原文**；tightness 由 ③ 的**捕获断言**（`= (\d+)` 恰好相等）保证。
 */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf-8');
}

function relToRoot(abs: string): string {
  return relative(ROOT, abs).split('\\').join('/');
}

function collectTsFiles(dir: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      collectTsFiles(join(dir, e.name), out);
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      out.push(join(dir, e.name));
    }
  }
}

describe('HD-P0-3 · B1 默认后端端口（跨部署单元同值契约）', () => {
  it('① 后端真源取值（改这里 ⇒ 下面各点会连带变红）', () => {
    expect(DEFAULT_HTTP_PORT).toBe(18990);
  });

  it('② 各定义点与真源**同值**（前端 TS / 构建配置 / Tauri Rust / 后端示例 env）', () => {
    const port = String(DEFAULT_HTTP_PORT);
    const points: Array<{ label: string; rel: string }> = [
      { label: '前端 TS 常量', rel: 'client/src/services/backendUrl.ts' },
      { label: 'vite proxy 兜底', rel: 'client/vite.config.ts' },
      {
        label: 'playwright webServer 兜底',
        rel: 'client/playwright.config.ts',
      },
      {
        label: 'Tauri 默认端口常量',
        rel: 'client/src-tauri/src/commands/app_config.rs',
      },
      {
        label: 'Tauri chat 内联字面量',
        rel: 'client/src-tauri/src/commands/chat.rs',
      },
      {
        label: 'Tauri backend_ctrl 内联字面量',
        rel: 'client/src-tauri/src/commands/backend_ctrl.rs',
      },
      { label: '后端示例 env', rel: 'app/.env.example' },
    ];
    const mismatches: string[] = [];
    for (const { label, rel } of points) {
      if (!read(rel).includes(port)) {
        mismatches.push(`${label}（${rel}）未包含真源端口 ${port}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('③ 命名/赋值点：取值**恰好**等于真源（不是"含某个 4-5 位数"）', () => {
    const port = String(DEFAULT_HTTP_PORT);
    const captured: Array<{ label: string; got: string | undefined }> = [
      {
        label: '前端 DEFAULT_BACKEND_PORT',
        got: read('client/src/services/backendUrl.ts').match(
          /DEFAULT_BACKEND_PORT\s*=\s*(\d+)/
        )?.[1],
      },
      {
        label: 'Tauri DEFAULT_HTTP_PORT',
        got: read('client/src-tauri/src/commands/app_config.rs').match(
          /DEFAULT_HTTP_PORT:\s*u16\s*=\s*(\d+)/
        )?.[1],
      },
      {
        label: '.env.example LIRI_HTTP_PORT',
        got: read('app/.env.example').match(
          /^LIRI_HTTP_PORT\s*=\s*(\d+)/m
        )?.[1],
      },
    ];
    const mismatches = captured
      .filter(({ got }) => got !== port)
      .map(({ label, got }) => `${label}: 取到 ${String(got)} ≠ 真源 ${port}`);
    expect(mismatches).toEqual([]);
  });
});

describe('HD-P0-3 · B2 日限额 SSE 事件名（跨部署单元同值契约）', () => {
  it('① 前端组件常量 === 后端导出常量', () => {
    // 前端为独立部署单元 ⇒ 用"同值断言"钉住（若将来把该常量集中到前端共享文件，
    // 改本行断言的读取目标即可，语义不变）。
    const captured = read(
      'client/src/components/usage/DailyBudgetPanel.tsx'
    ).match(/DAILY_BUDGET_SSE_EVENT\s*=\s*"([^"]+)"/)?.[1];
    expect(captured).toBe(DAILY_BUDGET_SSE_EVENT);
  });

  it('② 前端**仅一处**定义该事件名（订阅端应引用同一常量，勿再内联）', () => {
    const files: string[] = [];
    collectTsFiles(CLIENT_SRC, files);
    const defining = files
      .filter(
        (abs) => !abs.includes('__tests__') && !/\.test\.(ts|tsx)$/.test(abs)
      )
      .filter((abs) => {
        const code = readFileSync(abs, 'utf-8');
        return (
          code.includes(`"${DAILY_BUDGET_SSE_EVENT}"`) ||
          code.includes(`'${DAILY_BUDGET_SSE_EVENT}'`)
        );
      })
      .map(relToRoot);
    expect(defining).toEqual([
      'client/src/components/usage/DailyBudgetPanel.tsx',
    ]);
  });
});

/**
 * **B4 日预算错误码**：后端抛点 `preSendContextProtection.ts` 的
 * `AppError('DAILY_BUDGET_EXCEEDED')` ⟷ 前端**收口一处** `client/src/error/errorCodes.ts`。
 * 消费方（`DailyLimitNotice` 的分流判据 / `chatService` 的类型联合）均应**引用**该常量、
 * 不再内联字面量 ⇒ ② 断言前端仅一处定义。
 */
describe('HD-P0-3 · B4 日预算错误码（跨部署单元同值契约）', () => {
  it('① 前端常量取值 === 后端抛点取值（改任一侧即变红）', () => {
    const captured = read('client/src/error/errorCodes.ts').match(
      /DAILY_BUDGET_EXCEEDED\s*=\s*['"]([^'"]+)['"]/
    )?.[1];
    // 真源取值（改这一行 ⇒ ② 会连带变红）
    expect(captured).toBe('DAILY_BUDGET_EXCEEDED');
    expect(
      read('app/src/chat/orchestrator/preSendContextProtection.ts')
    ).toContain(`'${captured}'`);
  });

  it('② 前端**仅一处**定义该错误码（消费方引用常量，勿再内联）', () => {
    const files: string[] = [];
    collectTsFiles(CLIENT_SRC, files);
    const defining = files
      .filter(
        (abs) => !abs.includes('__tests__') && !/\.test\.(ts|tsx)$/.test(abs)
      )
      .filter((abs) => {
        const code = readFileSync(abs, 'utf-8');
        return (
          code.includes(`"${'DAILY_BUDGET_EXCEEDED'}"`) ||
          code.includes(`'${'DAILY_BUDGET_EXCEEDED'}'`)
        );
      })
      .map(relToRoot);
    expect(defining).toEqual(['client/src/error/errorCodes.ts']);
  });
});

/**
 * **B3 模型能力标签集**：前端键集（`client/src/constants/capabilities.ts`，单一事实源）
 * 必须 **⊆ 后端规范集合**（`app/src/ai/config/capabilities.default.yaml` 的 `capabilities[].key`）。
 * 判据是 **⊆**（前端是 UI 退化清单，有意不追平后端 28 键）—— 防"前端写了后端不存在的能力键"。
 */
describe('HD-P0-3 · B3 模型能力标签集（跨部署单元同值契约）', () => {
  function backendCapabilityKeys(): Set<string> {
    const yaml = read('app/src/ai/config/capabilities.default.yaml');
    const keys = new Set<string>();
    // 仅取 `capabilities:` 段内的 `key:`（`categories:` / `taskMappings:` 段的键名不同）
    for (const m of yaml.matchAll(/^\s{2}- key:\s*([A-Za-z_]+)\s*$/gm)) {
      keys.add(m[1] as string);
    }
    return keys;
  }

  function frontCapabilityKeys(): string[] {
    const src = read('client/src/constants/capabilities.ts');
    const body = src.match(
      /export const CAPABILITY = \{([\s\S]*?)\} as const/
    )?.[1];
    if (!body) return [];
    return [...body.matchAll(/^\s*\w+:\s*['"]([^'"]+)['"]/gm)].map(
      (m) => m[1] as string
    );
  }

  it('① 前端键集非空，且**每个**键都在后端规范集合内（⊆）', () => {
    const backend = backendCapabilityKeys();
    const front = frontCapabilityKeys();
    expect(backend.size).toBeGreaterThan(20); // 后端规范集合的规模哨兵
    expect(front.length).toBeGreaterThan(0);
    const unknown = front.filter((k) => !backend.has(k));
    expect(
      unknown,
      '前端存在后端规范集合里没有的能力键（会在后端静默失效）'
    ).toEqual([]);
  });

  it('② 前端**仅一处**定义能力键（消费方引用 `CAPABILITY`，勿再内联）', () => {
    // 键集**从模块自身派生**（自维护：新增键即自动纳入扫描）
    const keys = frontCapabilityKeys();
    expect(keys.length).toBeGreaterThan(0);
    const re = new RegExp(`key:\\s*["'](${keys.join('|')})["']`);
    const files: string[] = [];
    collectTsFiles(CLIENT_SRC, files);
    const defining = files
      .filter(
        (abs) =>
          !abs.includes('__tests__') &&
          !/\.test\.(ts|tsx)$/.test(abs) &&
          !abs.endsWith('constants/capabilities.ts')
      )
      .filter((abs) => re.test(readFileSync(abs, 'utf-8')))
      .map(relToRoot);
    expect(defining).toEqual([]);
  });
});
