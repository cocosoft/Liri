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
 * 梦境引擎模块导出
 */

export { DreamEngine } from './DreamEngine';
export { DreamScheduler } from './DreamScheduler';
export { DreamIdleDetector } from './DreamIdleDetector';
export { DreamPhaseManager } from './DreamPhaseManager';
export { DreamPersistence } from './DreamPersistence';

export type {
  DreamPhase,
  DreamTriggerSource,
  DreamSchedulerConfig,
  DreamRecord,
} from './types';
export { DEFAULT_DREAM_SCHEDULER_CONFIG } from './types';

// D1-Step2：自主运行计划契约 + 执行 deny 规则
export {
  parseDreamPlan,
  validateDreamPlan,
  buildDreamPlanMarkdown,
  type DreamPlan,
  type DreamPlanMeta,
  type DreamPlanValidation,
} from './plan/DreamPlanContract';
export {
  AUTONOMOUS_DENY_COMMAND_PREFIXES,
  AUTONOMOUS_DENY_TOOLS,
  isDeniedByAutonomousRules,
  isDeniedToolByAutonomousRules,
  checkAutonomousOperation,
} from './execution/DreamDenyRules';
