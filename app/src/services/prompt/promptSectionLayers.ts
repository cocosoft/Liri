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
import type { StaticPromptSectionName } from '../../constants/systemPromptSections';

export type PromptLayer = 'L0' | 'L1' | 'L2' | 'L3';

export interface PromptSectionMeta {
  /** 分层身份：L0 系统性约束 / L1 身份人格 / L2 项目会话动态 / L3 检索型大块 */
  layer: PromptLayer;
  /** 可见模式。缺省 = 仅 full 模式可见 */
  visibleIn?: PromptMode[];
}

/** 未登记段的默认层（会话动态类占多数，默认 L2；可见性默认仅 full） */
export const DEFAULT_SECTION_LAYER: PromptLayer = 'L2';

/**
 * 段落登记表 —— **穷尽校验**：`DEFAULT_SECTIONS` 的每个段名都必须在此出现，否则**编译失败**
 * （`Record<StaticPromptSectionName, …>` 缺键即 TS 报错；`Record<string, …>` 允许非静态段，
 * 如 `localToolUse`（由过滤链在 local 模式替换注入，不入白名单））。
 *
 * 为何必须显式登记：**未登记 = 仅 full 可见**（`isSectionVisibleIn` 的 `?? false`），
 * 漏登记会**静默失效** —— 不报错、不进提示词、无任何可观测信号。
 * 实机踩过：`outputArtifactBoundary` 在 `mode=conversation` 下完全不注入，两次实机验证才暴露
 * （台账 N-60）。新增段请在此二选一：`visibleIn` 声明可见模式，或不声明（仅 full）。
 */
const SECTION_META = {
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
  // W2（2026-09-25，方案 A）：交付物落点口径。**必须显式登记**，否则默认"仅 full 可见"
  // （本文件注释即此约束）—— 实机补验已证实：漏登记时该段根本不进提示词。
  // 全模式可见：它决定产物落点与「成果」可见性，本地模型同样会把产物写到 output 目录。
  outputArtifactBoundary: {
    layer: 'L0',
    visibleIn: ['full', 'conversation', 'minimal', 'local'],
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
  // L3 检索型大块（仅 full 可见，维持现状；预算超限时先于 L2 被降级丢弃）
  memoryContext: { layer: 'L3' },
  knowledgeContext: { layer: 'L3' },
  knowledgeDigest: { layer: 'L3' },
  fewShotExamples: { layer: 'L3' },
  knowledgeSaveGuide: { layer: 'L3' },

  // ↓ 以下 6 段此前**漏登记**（⇒ 实际仅 full 可见，静默无信号）。本轮补登记以满足穷尽门禁：
  //   **不声明 visibleIn ⇒ 行为与之前完全一致**（仍仅 full），只是把"隐式"变"显式"。
  pdcaThinking: { layer: 'L0' },
  projectRules: { layer: 'L2' },
  toolsConvention: { layer: 'L2' },
  projectMeta: { layer: 'L2' },
  skills: { layer: 'L2' },
  gitContext: { layer: 'L2' },
} satisfies Record<StaticPromptSectionName, PromptSectionMeta> &
  Record<string, PromptSectionMeta>;

/**
 * 字符串键查询视图。
 *
 * `SECTION_META` 保留**字面量键类型**（穷尽门禁需要），而 `getSectionMeta` /
 * `getSectionLayer` / `isSectionVisibleIn` 的入参是运行时 `string` ⇒ 在此显式拓宽
 * （含 `undefined`，使未登记段仍走 `?? 默认` 分支）。
 */
const META_LOOKUP: Record<string, PromptSectionMeta | undefined> = SECTION_META;

export function getSectionMeta(name: string): PromptSectionMeta {
  return META_LOOKUP[name] ?? { layer: DEFAULT_SECTION_LAYER };
}

/**
 * 该段名是否已在登记表**显式声明**。
 *
 * 供门禁用例（`tests/prompt/promptSectionLayersGate.test.ts`）与诊断使用：
 * 未声明 = 仅 full 可见 ⇒ 新增段漏登记会**静默不进提示词**（详见文件头注释与台账 N-60）。
 */
export function isSectionDeclared(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(SECTION_META, name);
}

export function getSectionLayer(name: string): PromptLayer {
  return META_LOOKUP[name]?.layer ?? DEFAULT_SECTION_LAYER;
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
  return META_LOOKUP[name]?.visibleIn?.includes(mode) ?? false;
}
