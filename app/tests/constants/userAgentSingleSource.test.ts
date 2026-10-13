/**
 * HD-P1-1（硬编码治理方案 §4.1 A7 / §7.2）—— **产品 User-Agent 单一真源守卫**。
 *
 * 契约：
 * - **版本号只来自一处**：`USER_AGENT = 'Liri/' + APP_VERSION`（`APP_VERSION` 读 `app/package.json`）；
 * - **14 个消费点**一律经 `USER_AGENT` / `buildUserAgent(purpose)` 派生，**不得**再写死 UA 字面量；
 * - **协议伪装 UA 不并入**（见方案 §5）：抓 HTML 的 Chrome 伪装 UA 与 edge-tts 的 Chromium UA
 *   属"协议要求"而非"产品标识" ⇒ 本测试**反向钉住**它们原样保留。
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  APP_VERSION,
  USER_AGENT,
  buildUserAgent,
} from '../../src/constants/common';

/** `app/`（`app/tests/constants/` → 上两级） */
const APP = join(import.meta.dir, '..', '..');
const SRC = join(APP, 'src');

function collectProductionTs(dir: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      collectProductionTs(join(dir, e.name), out);
    } else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) {
      out.push(join(dir, e.name));
    }
  }
}

const rel = (abs: string): string => relative(APP, abs).split('\\').join('/');

/** 注释行判据（**不**用"先剥 `//` 注释"—— 那会误伤 `http://`，见 HD-P0-3 实测） */
function isCommentLine(line: string): boolean {
  const s = line.trimStart();
  return s.startsWith('//') || s.startsWith('*') || s.startsWith('/*');
}

/**
 * **产品 UA 字面量**判据 —— **精确到事实**：`'User-Agent'` **头**的值不得是产品 UA 字面量。
 *
 * ⚠️ 口径为何这么窄（初版过宽，实测抓错）：初版用「任意 `'Liri/…'` 字面量」⇒ 会命中
 * **不同事实源**的 4 处 —— MCP 服务器的**协议标识** `name: 'Liri/memory'` / `'Liri/mcp'`
 * 与两条含 `Liri/memory` 的**日志文案**（见下方 ⑥）。把"协议标识 / 日志文案"当 UA 收编是错的。
 */
const UA_HEADER_LITERAL =
  /['"`]User-Agent['"`]\s*:\s*['"`](Liri[-/]|PY_APP-Knowledge)/;

/** **有意不治理**的协议伪装 UA（不可合并进产品标识；按**站点**断言，不按文件） */
const DISGUISE_UA: Array<{ rel: string; site: RegExp; label: string }> = [
  {
    rel: 'src/tools/WebSearchTool/providers.ts',
    site: /Mozilla\/5\.0.*Chrome\/120\.0\.0\.0/,
    label: '抓 HTML 的反爬伪装 UA（Chrome）',
  },
  {
    rel: 'src/services/voice/services/edgeTTSProvider.ts',
    site: /CHROMIUM_FULL_VERSION = '\d+\.\d+\.\d+\.\d+'/,
    label: 'edge-tts 协议要求的 Chromium 版本',
  },
];

/**
 * **新发现（本片不治理，登记）**：MCP 服务器**协议标识**
 * （`entrypoints/mcp-memory.ts` 的 `name: 'Liri/memory'`、`entrypoints/mcp.ts` 的 `name: 'Liri/mcp'`，
 * 两者 `version: '1.0.0'`）。
 *
 * 与 HTTP `User-Agent` 属**不同事实源**：它是 MCP 握手里的"实现描述符"（`McpServer({name, version})`），
 * 改 `version` 会让已接入的 MCP 客户端看到不同的实现版本 ⇒ 属**协议面行为变更**，须单独裁定
 * （与 §5 `N8`「Tauri bundle id」同类）。本测试**反向钉住**它未被误并入产品 UA。
 */
const MCP_SERVER_IDENTITY: Array<{ rel: string; site: RegExp }> = [
  { rel: 'src/entrypoints/mcp-memory.ts', site: /name: 'Liri\/memory'/ },
  { rel: 'src/entrypoints/mcp.ts', site: /name: 'Liri\/mcp'/ },
];

describe('HD-P1-1 · 产品 User-Agent 单一真源', () => {
  it('① 真源：`Liri/<APP_VERSION>`（版本号来自 package.json，不是写死串）', () => {
    expect(USER_AGENT).toBe(`Liri/${APP_VERSION}`);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('② 派生器：`buildUserAgent(purpose)` ⇒ `Liri/<版本> (<用途>)`', () => {
    expect(buildUserAgent('WebFetch')).toBe(`${USER_AGENT} (WebFetch)`);
    expect(buildUserAgent('MCPMarketplace').startsWith(USER_AGENT)).toBe(true);
    // 版本号只有一个来源：改 APP_VERSION 即全局跟随
    expect(buildUserAgent('X')).toContain(APP_VERSION);
  });

  it('③ `User-Agent` 头的值不再有产品 UA 字面量（真源除外）', () => {
    const files: string[] = [];
    collectProductionTs(SRC, files);
    const hits: string[] = [];
    for (const abs of files) {
      const r = rel(abs);
      if (r === 'src/constants/common.ts') continue; // 真源
      readFileSync(abs, 'utf-8')
        .split('\n')
        .forEach((line, i) => {
          if (isCommentLine(line)) return;
          if (UA_HEADER_LITERAL.test(line)) hits.push(`${r}:${i + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });

  it('④ 协议伪装 UA **按站点**原样保留、且未改为派生（方案 §5 不治理项）', () => {
    const mismatches: string[] = [];
    for (const { rel: r, site, label } of DISGUISE_UA) {
      const hit = readFileSync(join(APP, r), 'utf-8')
        .split('\n')
        .find((l) => site.test(l));
      if (!hit) {
        mismatches.push(`${label}（${r}）已丢失`);
        continue;
      }
      if (/buildUserAgent\(|USER_AGENT\b/.test(hit)) {
        mismatches.push(`${label}（${r}）被误改为产品 UA 派生 —— 它属协议要求`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('⑤ 14 个消费点均引用真源（不漏改）', () => {
    const consumers = [
      'src/services/api/client.ts',
      'src/tools/WebFetchTool/utils.ts',
      'src/tools/WebFetchTool/WebFetchTool.ts',
      'src/tools/WebSearchTool/WebSearchTool.ts',
      'src/tools/WebSearchTool/providers.ts',
      'src/tools/web/WebToolProvider.ts',
      'src/services/voice/services/streamSTTProvider.ts',
      'src/cli/updater/GitHubReleaseFetcher.ts',
      'src/chat/services/ImageDownloader.ts',
      'src/skills/loaders/adapter/clawhub/ClawHubAPIClient.ts',
      'src/knowledge/datasource/RSSConnector.ts',
      'src/services/mcp/marketplace/adapters/SmitheryRegistryAdapter.ts',
      'src/services/mcp/marketplace/adapters/NPMRegistryAdapter.ts',
      'src/services/mcp/marketplace/adapters/GitHubRegistryAdapter.ts',
    ];
    // 只看**用法**（排除 import 行）—— 否则"只 import 不引用"也会蒙混过关
    const missing = consumers.filter((r) => {
      const body = readFileSync(join(APP, r), 'utf-8')
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('import '))
        .join('\n');
      return !/USER_AGENT|buildUserAgent\s*\(/.test(body);
    });
    expect(missing).toEqual([]);
  });

  it('⑥ MCP 服务器协议标识未被误并入产品 UA（**不同事实源**，本片登记不治理）', () => {
    const mismatches: string[] = [];
    for (const { rel: r, site } of MCP_SERVER_IDENTITY) {
      const src = readFileSync(join(APP, r), 'utf-8');
      if (!site.test(src))
        mismatches.push(`${r} 的协议标识已丢失（不应被改名）`);
      if (/buildUserAgent\(|USER_AGENT\b/.test(src)) {
        mismatches.push(`${r} 被误并入产品 UA（MCP 协议标识 ≠ HTTP UA）`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
