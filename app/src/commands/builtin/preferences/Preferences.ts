// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `/preferences`（别名 `/profile`、`/pref`）—— 用户偏好的**统一查看/修改入口**（G5，2026-11-14）
 *
 * 语义（不新增存储，R02）：
 * - 人读真源 = `~/.pyapp/USER.md` 的 `## 偏好` 小节（本命令读写）；
 * - 机器记忆 = 既有 `USER_PREFERENCE` 记忆条目（只读聚合展示；`remove #<id>` 走既有
 *   `MemoryManager.deleteMemory`）。
 *
 * 用法：
 *   /preferences              列出（USER.md 偏好 + USER_PREFERENCE 记忆）
 *   /preferences add <文本>   追加一条偏好（幂等）
 *   /preferences remove <文本|#id>  删除（文本 ⇒ USER.md 条目；#id ⇒ 记忆条目）
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CommandContext, CommandResult } from '@modules/commands';
import { resolveUserProfilePath } from '@openliri/infra/environment';
import { getMemoryManager, MemoryType } from '@openliri/infra/memory';
import { getLogger } from '@openliri/infra/monitoring';
import {
  addPreferenceLine,
  parsePreferenceLines,
  removePreferenceLines,
} from './preferencesCore.js';

const logger = getLogger('commands:builtin:preferences');

const PREFERENCES_USAGE = [
  '用法：',
  '  /preferences                 列出偏好（USER.md + 自动沉淀的记忆）',
  '  /preferences add <文本>      追加一条偏好',
  '  /preferences remove <文本>   删除 USER.md 中的偏好条目',
  '  /preferences remove #<id>    删除一条 USER_PREFERENCE 记忆',
].join('\n');

function readUserProfile(): string {
  const file = resolveUserProfilePath();
  try {
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  } catch (e) {
    logger.warn('读取 USER.md 失败', { error: String(e) });
    return '';
  }
}

function writeUserProfile(content: string): void {
  const file = resolveUserProfilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf-8');
}

/** 读取既有 `USER_PREFERENCE` 记忆（失败 ⇒ 空数组，如实降级不误导） */
async function listPreferenceMemories(): Promise<
  Array<{ id: string; content: string }>
> {
  try {
    const all = await getMemoryManager().getAllMemories();
    return all
      .filter((m) => m.metadata?.type === MemoryType.USER_PREFERENCE)
      .map((m) => ({ id: m.id, content: m.content }));
  } catch (e) {
    logger.warn('读取 USER_PREFERENCE 记忆失败', { error: String(e) });
    return [];
  }
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function ok(message: string, data?: unknown): CommandResult {
  return { success: true, type: 'text', message, data };
}

function fail(error: string): CommandResult {
  return { success: false, type: 'error', error };
}

const preferencesCommand = {
  async execute(
    args: string,
    _context: CommandContext
  ): Promise<CommandResult> {
    const [action = 'list', ...rest] = args.trim().split(/\s+/);
    const payload = rest.join(' ').trim();

    if (action === 'help' || action === '--help' || action === '-h') {
      return ok(PREFERENCES_USAGE);
    }
    if (action === 'list' || action === '') {
      return this.list();
    }
    if (action === 'add') {
      return this.add(payload);
    }
    if (action === 'remove' || action === 'rm') {
      return this.remove(payload);
    }
    return fail(`未知子命令：${action}\n${PREFERENCES_USAGE}`);
  },

  async list(): Promise<CommandResult> {
    const lines = parsePreferenceLines(readUserProfile());
    const memories = await listPreferenceMemories();

    const sections: string[] = [];
    sections.push(`USER.md 偏好（${resolveUserProfilePath()}）：`);
    sections.push(
      lines.length > 0
        ? lines.map((t) => `  - ${t}`).join('\n')
        : '  （尚未设置；用 /preferences add <文本> 添加）'
    );
    sections.push(
      `自动沉淀的用户偏好记忆（USER_PREFERENCE，${memories.length} 条）：`
    );
    sections.push(
      memories.length > 0
        ? memories.map((m) => `  #${shortId(m.id)}  ${m.content}`).join('\n')
        : '  （暂无；对话中表达偏好后由记忆系统自动沉淀）'
    );
    return ok(sections.join('\n'), {
      userProfilePreferences: lines,
      preferenceMemories: memories.length,
    });
  },

  add(text: string): CommandResult {
    if (!text) return fail(`缺少要添加的内容\n${PREFERENCES_USAGE}`);
    const before = readUserProfile();
    const result = addPreferenceLine(before, text);
    if (!result.added) {
      return result.reason === 'duplicate'
        ? ok(`偏好已存在（未重复写入）：${text.trim()}`)
        : fail('偏好内容不能为空');
    }
    try {
      writeUserProfile(result.markdown);
    } catch (e) {
      return fail(
        `写入 USER.md 失败：${e instanceof Error ? e.message : String(e)}`
      );
    }
    return ok(`已记录偏好：${text.trim()}`, { file: resolveUserProfilePath() });
  },

  async remove(target: string): Promise<CommandResult> {
    if (!target) return fail(`缺少要删除的内容或记忆 id\n${PREFERENCES_USAGE}`);

    // `#<id>` ⇒ 删除既有记忆条目（不新增存储，直接走 MemoryManager）
    if (/^#[^\s]+$/.test(target)) {
      const id = target.slice(1);
      try {
        const all = await getMemoryManager().getAllMemories();
        const hit = all.find((m) => m.id === id || m.id.startsWith(id));
        if (!hit) return fail(`未找到记忆：${target}`);
        await getMemoryManager().deleteMemory(hit.id);
        return ok(`已删除偏好记忆 #${shortId(hit.id)}：${hit.content}`);
      } catch (e) {
        return fail(
          `删除记忆失败：${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    const result = removePreferenceLines(readUserProfile(), target);
    if (result.removed.length === 0) {
      return fail(`USER.md 中没有匹配「${target}」的偏好条目`);
    }
    try {
      writeUserProfile(result.markdown);
    } catch (e) {
      return fail(
        `写入 USER.md 失败：${e instanceof Error ? e.message : String(e)}`
      );
    }
    return ok(
      `已删除 ${result.removed.length} 条偏好：${result.removed.join('；')}`
    );
  },
};

export default preferencesCommand;
