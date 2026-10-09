// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { CHANNEL_CATALOG } from '../../src/channels/ChannelCatalog';
import type { ChannelCapabilities } from '../../src/channels/types';

/**
 * R11 **通道能力契约矩阵**（第九轮审查 §5.2）。
 *
 * 外部主张：26 通道各平台**能力不一**，应"把通道分为**通用必需能力**与**平台可选能力**，
 * 在适配层**显式声明能力**，而不是用**平台名称判断**来分支"；并给出 6 项契约检查
 * （长文本分片 / 附件关联 / 限流重连不重复 / 编辑语义 / 能力降级 / 多账号隔离）。
 *
 * 本测试覆盖**声明层**契约（对所有 26 通道逐一遍历）+ **"禁止平台名判断"守则**：
 *   C1 **声明完整性**：`capabilities` 的 10 个**通用必需位**齐备且均为布尔。
 *   C2 **无未知能力位**：能力对象键 ⊆ 已知位集合（防拼写漂移 / 私自扩张）。
 *   C3 **身份一致**：`plugin.id === meta.id === catalog.type`（跨源单一）。
 *   C4 **消息长度契约**：`maxMessageLength` 为正整数；`recommendedMaxLength ≤ maxMessageLength`。
 *   C5 **能力 ⇔ 出站方法**：声明 `fileUpload/imageMessage/interactive` ⇒ 对应 `outbound.send*` 存在。
 *   C6 **禁用平台名判断**（守则 + 自证）：`channels/**` 源码内**不得**出现 `=== '<平台id>'`
 *      形式的平台名分支 —— 能力差异**必须**走能力位。
 *
 * 行为层契约（格式降级链 / 串行化 / 多账号隔离）见同目录
 * `deliveryRouterContract.test.ts` 与 `multiAccountIsolation.test.ts`。
 */

/** `ChannelCapabilities` 的**通用必需位**（10 个），见 `types/IChannel.ts` */
const REQUIRED_CAPS: ReadonlyArray<keyof ChannelCapabilities> = [
  'directMessage',
  'groupMessage',
  'groupMention',
  'threading',
  'reactions',
  'interactive',
  'voiceCall',
  'fileUpload',
  'imageMessage',
  'webhook',
];
/** 已知能力位（含平台可选位 `passiveReplyWindow`） */
const KNOWN_CAPS = new Set<string>([...REQUIRED_CAPS, 'passiveReplyWindow']);

interface MetaLike {
  id: string;
  maxMessageLength: number;
  supportedMessageTypes: string[];
  messageToolHints?: { recommendedMaxLength?: number };
}
interface PluginLike {
  id: string;
  meta: MetaLike;
  capabilities: ChannelCapabilities;
  outbound: {
    sendFile?: unknown;
    sendImage?: unknown;
    sendInteractive?: unknown;
  };
}

/** 从通道模块导出中取出插件实例（按 catalog 的 exportKey） */
function asPlugin(
  mod: Record<string, unknown>,
  exportKey: string
): PluginLike | null {
  const v = mod[exportKey];
  if (!v || typeof v !== 'object') return null;
  const rec = v as Record<string, unknown>;
  if (!rec.id || !rec.meta || !rec.capabilities || !rec.outbound) return null;
  return rec as unknown as PluginLike;
}

const PLATFORM_IDS = CHANNEL_CATALOG.map((e) => e.type);

/**
 * 扫描源码中"平台名判断"（**纯函数**，供自证）。
 * 命中形如 `x === 'qq'` / `x !== 'telegram'` 的分支 —— 能力差异必须走能力位。
 */
function scanPlatformBranches(text: string, ids: string[]): string[] {
  const hits: string[] = [];
  for (const id of ids) {
    const re = new RegExp(`[=!]==?\\s*['"\`]${id}['"\`]`, 'g');
    if (re.test(text)) hits.push(id);
  }
  return hits;
}

const REPO_ROOT = resolve(import.meta.dir, '../../..');
/** 本文件自身含平台 id 字面量列表 ⇒ 扫描时排除（相对仓库根，正斜杠） */
const SELF = 'app/tests/channels/channelCapabilityContract.test.ts';

function collectTsFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collectTsFiles(full, out);
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('R11-C6 自证：平台名判断扫描器有效（防"恒 0 空转"）', () => {
  it("含 === 'qq' 的源码 ⇒ 命中；干净源码 ⇒ 不命中", () => {
    expect(
      scanPlatformBranches("if (id === 'qq') { x(); }", PLATFORM_IDS)
    ).toEqual(['qq']);
    expect(
      scanPlatformBranches("if (msgtype === 'text') { x(); }", PLATFORM_IDS)
    ).toEqual([]);
  });
});

describe('R11-C6 守则：channels/** 不得用平台名判断分支', () => {
  it("源码内无 `=== '<平台id>'` 形式的能力分支", () => {
    const files = collectTsFiles(join(REPO_ROOT, 'app', 'src', 'channels'));
    const offenders: string[] = [];
    for (const full of files) {
      const rel = relative(REPO_ROOT, full).replace(/\\/g, '/');
      if (rel === SELF) continue;
      const hits = scanPlatformBranches(
        readFileSync(full, 'utf-8'),
        PLATFORM_IDS
      );
      if (hits.length > 0) offenders.push(`${rel}: [${hits.join(',')}]`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('R11 能力契约矩阵：逐通道声明完整性 + 身份一致', () => {
  for (const entry of CHANNEL_CATALOG) {
    describe(`[${entry.type}] ${entry.name}`, () => {
      const load = async (): Promise<PluginLike> => {
        const mod = (await entry.load()) as Record<string, unknown>;
        const plugin = asPlugin(mod, entry.exportKey);
        expect(
          plugin,
          `${entry.type} 未从 exportKey "${entry.exportKey}" 取到含 capabilities/meta 的插件`
        ).not.toBeNull();
        return plugin!;
      };

      it('C3 身份一致：plugin.id === meta.id === catalog.type', async () => {
        const p = await load();
        expect(p.id).toBe(entry.type);
        expect(p.meta.id).toBe(entry.type);
      });

      it('C1 通用必需能力位齐备且均为布尔', async () => {
        const p = await load();
        for (const key of REQUIRED_CAPS) {
          expect(
            typeof p.capabilities[key],
            `${entry.type}.capabilities.${String(key)} 必须为布尔`
          ).toBe('boolean');
        }
      });

      it('C2 无未知能力位（防拼写漂移）', async () => {
        const p = await load();
        const unknown = Object.keys(p.capabilities).filter(
          (k) => !KNOWN_CAPS.has(k)
        );
        expect(
          unknown,
          `${entry.type} 未知能力位: ${unknown.join(',')}`
        ).toEqual([]);
      });

      it('C4 消息长度契约：maxMessageLength 正整数；recommendedMaxLength ≤ maxMessageLength', async () => {
        const p = await load();
        expect(Number.isInteger(p.meta.maxMessageLength)).toBe(true);
        expect(p.meta.maxMessageLength).toBeGreaterThan(0);
        expect(Array.isArray(p.meta.supportedMessageTypes)).toBe(true);
        expect(p.meta.supportedMessageTypes.length).toBeGreaterThan(0);
        const rec = p.meta.messageToolHints?.recommendedMaxLength;
        if (rec !== undefined) {
          expect(Number.isInteger(rec)).toBe(true);
          expect(rec).toBeLessThanOrEqual(p.meta.maxMessageLength);
        }
      });

      it('C5 能力 ⇔ 出站方法：声明能力 ⇒ 对应 send* 存在', async () => {
        const p = await load();
        if (p.capabilities.fileUpload)
          expect(typeof p.outbound.sendFile).toBe('function');
        if (p.capabilities.imageMessage)
          expect(typeof p.outbound.sendImage).toBe('function');
        if (p.capabilities.interactive)
          expect(typeof p.outbound.sendInteractive).toBe('function');
      });
    });
  }
});
