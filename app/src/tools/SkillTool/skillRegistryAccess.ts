// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 惰性访问全局 skillRegistry（T9'，2026-08-30）
 *
 * skills_list / skill_view / SkillTool 共用：避免顶层 import
 * `@modules/constants/systemPromptSections`（其依赖 @modules/context 等重模块，
 * 在 bun test 加载 skills 链时触发循环 TDZ）。首次访问触发异步 import，
 * 同步读缓存引用；不可用时返回 null（调用方回退）。
 */

import type { Skill } from '@modules/skills/types';

export type SkillRegistryReader = {
  getAll(opts?: { includeDisabled?: boolean }): Skill[];
  get(name: string, opts?: { includeDisabled?: boolean }): Skill | undefined;
};

let lazySkillRegistry: SkillRegistryReader | null = null;
let registryLoading = false;

/** 获取 skillRegistry 惰性引用（可能为 null=尚未就绪/不可用） */
export function getSkillRegistryLazy(): SkillRegistryReader | null {
  if (!lazySkillRegistry && !registryLoading) {
    registryLoading = true;
    import('@modules/constants/systemPromptSections')
      .then((m) => {
        lazySkillRegistry = m.skillRegistry as unknown as SkillRegistryReader;
      })
      .catch(() => {
        // registry 不可用：保持 null
      });
  }
  return lazySkillRegistry;
}
