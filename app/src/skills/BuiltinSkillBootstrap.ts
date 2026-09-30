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

/**
 * 内置 / 用户技能装配（2026-09-30 台账 D-126，`R00-003` P6-b / G6-a **迁移**）
 *
 * **为什么迁移**：`initBuiltinSkills` / `reloadUserSkills` 原先定义在
 * `constants/systemPromptSections.ts`（**infra**），却**动态导入** `skills`（**app**，加载器与类型）
 * ⇒ 构成 `infra -> app` 跨层引用（`R00-003` 盲区）。二者本质是**技能装配**（app 域内职责），
 * 迁入 `skills` 后：
 * - 加载器 / 类型 / `BuiltinEnabledStore` 同级引用 ⇒ **同模块内自洽**；
 * - 仍复用 `constants/systemPromptSections` 的 **`skillRegistry` / `skillInjectionService` 单例**
 *   （`app -> infra` **合法**，**不新增对**，且避免出现第二份注册表导致技能丢失）。
 *
 * **调用方（迁移后）**：`entrypoints/init.ts`（entry，直连 app ✓）· 服务层经
 * `CoreAPI.getSkillsOpsPort().reloadUserSkills()`（`runtime -> skills` 属**既有 sanctioned 缝**）。
 */

import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { resolveUserSkillsDir } from '@modules/core/paths';
import {
  skillRegistry,
  skillInjectionService,
} from '@modules/constants/systemPromptSections';
import { getSkillHub } from './SkillHub';
import { loadBuiltinEnabled } from './BuiltinEnabledStore';
import { BundledSkillLoader } from './loaders/sources/BundledSkillLoader';
import { FileSkillLoader } from './loaders/sources/FileSkillLoader';
import { SkillSource } from './types';

/**
 * 初始化内建技能（BundledSkillLoader 程序化定义 → SkillRegistry 注册）
 * 在应用启动时调用一次即可
 * 2026-08-06：原 FileSkillLoader 扫描 app/src/builtin/skills/（目录不存在，加载 0 个）；
 * 改为 BundledSkillLoader（10 个内置技能定义），修复内置技能未注册/前端不显示。
 * 2026-08-06 fix：同时加载用户技能目录（~/.pyapp/skills/ 下 SKILL.md），
 * 否则用户新建技能从不进入运行时 registry，SkillTool/注入均无法感知。
 */
export async function initBuiltinSkills(): Promise<void> {
  const loader = new BundledSkillLoader();
  const userLoader = new FileSkillLoader({
    directories: [resolveUserSkillsDir()],
    source: SkillSource.THIRD_PARTY,
    loadedFrom: 'user',
  });
  const [skills, userSkills] = await Promise.all([
    loader.loadSkills(),
    userLoader.loadSkills(),
  ]);
  // 3.5.7：恢复内置技能禁用状态（持久化 builtin-enabled.json），避免重启后复活
  const builtinEnabled = loadBuiltinEnabled();
  const allSkills = [...skills, ...userSkills];
  for (const skill of allSkills) {
    if (skillRegistry.has(skill.name, { includeDisabled: true })) continue;
    skillRegistry.register(skill);
    if (builtinEnabled.has(skill.name)) {
      skillRegistry.setEnabled(skill.name, builtinEnabled.get(skill.name)!);
    }
  }
  // v1.5：绑定 SkillHub 只读投影（幂等），后续 setEnabled 经 skill-updated 事件自动刷新
  getSkillHub().bindTo(skillRegistry);
}

/**
 * 重载用户技能目录（~/.pyapp/skills/）到运行时 registry。
 * 2026-08-06：用户通过技能创建/导入写盘 SKILL.md 后调用，使新增技能立即可被
 * SkillTool 同步与 SkillInjectionService 注入感知，无需重启。
 */
export async function reloadUserSkills(): Promise<void> {
  const dir = resolveUserSkillsDir();
  const loader = new FileSkillLoader({
    directories: [dir],
    source: SkillSource.THIRD_PARTY,
    loadedFrom: 'user',
  });
  const skills = await loader.loadSkills();
  // 磁盘上已删除的用户技能 → 从 registry 移除（覆盖删除场景）
  const onDisk = new Set(skills.map((s) => s.name));
  for (const existing of skillRegistry.getAll({ includeDisabled: true })) {
    if (existing.loadedFrom === 'user' && !onDisk.has(existing.name)) {
      skillRegistry.unregister(existing.name);
    }
  }
  // 新增用户技能 → 注册（含 .enabled 审批标记）
  let added = 0;
  for (const skill of skills) {
    if (skillRegistry.has(skill.name, { includeDisabled: true })) continue;
    skillRegistry.register(skill);
    added++;
    // 导入审批：敏感权限技能 .enabled 标记为 false → 注册为禁用（含权限审批技能）
    const enabledFile = join(dir, skill.name, '.enabled');
    if (
      existsSync(enabledFile) &&
      readFileSync(enabledFile, 'utf-8').trim() === 'false'
    ) {
      skillRegistry.setEnabled(skill.name, false);
    }
  }
  if (added > 0) {
    getSkillHub().bindTo(skillRegistry);
    // refreshAll 内部会 clear L1 缓存并重读 registry，使注入服务感知新技能
    await skillInjectionService.refreshAll();
  }
  return;
}
