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
 * P0-2（提示词分层治理）：段落 layer 元数据注册表
 *
 * 替代 PromptAssembler 中 CORE/CONVERSATION/LOCAL 三套手工白名单 Set：
 * - 每个已登记段声明 layer（L0 系统性约束 / L1 身份人格 / L2 项目会话动态 / L3 检索型大块）
 * - visibleIn 声明段在哪些 PromptMode 可见（默认未登记 = 仅 full——等价旧行为：
 *   Set 之外的注册段只在 full 模式出现，如 projectRules/gitContext/memoryContext 等）
 * - layer 供后续 P1 预算前置/段级降级链按层决策
 *
 * 新增注册段若需在 full 之外的模式可见，在此登记 visibleIn（消灭"往 Set 加名字"）。
 */

import type { PromptMode } from './types';

export type PromptLayer = 'L0' | 'L1' | 'L2' | 'L3';

export interface PromptSectionMeta {
  /** 分层身份：L0 系统性约束 / L1 身份人格 / L2 项目会话动态 / L3 检索型大块 */
  layer: PromptLayer;
  /** 可见模式。缺省 = 仅 full 模式可见 */
  visibleIn?: PromptMode[];
}

/** 未登记段的默认层（会话动态类占多数，默认 L2；可见性默认仅 full） */
export const DEFAULT_SECTION_LAYER: PromptLayer = 'L2';

const SECTION_META: Record<string, PromptSectionMeta> = {
  // 系统性约束（identity 属"最小存活前缀"，minimal 模式亦保留）
  identity: {
    layer: 'L0',
    visibleIn: ['full', 'conversation', 'minimal', 'local'],
  },
  personality: {
    layer: 'L1',
    visibleIn: ['full', 'conversation', 'minimal', 'local'],
  },
  userProfile: {
    layer: 'L1',
    visibleIn: ['full', 'conversation', 'minimal', 'local'],
  },
  toolUse: {
    layer: 'L0',
    visibleIn: ['full', 'conversation', 'minimal', 'local'],
  },
  // 依赖已裁剪工具集的规则段：本地模式不注入
  toolIntegrity: {
    layer: 'L0',
    visibleIn: ['full', 'conversation', 'minimal'],
  },
  shellDeclaration: {
    layer: 'L0',
    visibleIn: ['full', 'conversation', 'minimal'],
  },
  taskNegotiation: {
    layer: 'L2',
    visibleIn: ['full', 'conversation'],
  },
  sessionContext: {
    layer: 'L2',
    visibleIn: ['full', 'conversation', 'local'],
  },
  projectContext: {
    layer: 'L2',
    visibleIn: ['full', 'conversation', 'local'],
  },
  // toolUse 的本地替代段（filter 在 local 模式替换注入，不入白名单）
  localToolUse: { layer: 'L0' },
};

export function getSectionMeta(name: string): PromptSectionMeta {
  return SECTION_META[name] ?? { layer: DEFAULT_SECTION_LAYER };
}

export function getSectionLayer(name: string): PromptLayer {
  return SECTION_META[name]?.layer ?? DEFAULT_SECTION_LAYER;
}

/**
 * 段在指定模式是否可见（声明式判定，替代 CORE/CONVERSATION/LOCAL Set）
 * - full：全部段
 * - none：仅 identity（最小存活前缀）
 * - 其余模式：按 visibleIn 白名单；未登记段仅 full 可见
 */
export function isSectionVisibleIn(name: string, mode: PromptMode): boolean {
  if (mode === 'full') return true;
  if (mode === 'none') return name === 'identity';
  return SECTION_META[name]?.visibleIn?.includes(mode) ?? false;
}
