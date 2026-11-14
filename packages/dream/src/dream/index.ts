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

export { DreamEngine } from '@modules/dream/DreamEngine';
export { DreamScheduler } from '@modules/dream/DreamScheduler';
export { DreamIdleDetector } from '@modules/dream/DreamIdleDetector';
export { DreamPhaseManager } from '@modules/dream/DreamPhaseManager';
export { DreamPersistence } from '@modules/dream/DreamPersistence';

export type {
  DreamPhase,
  DreamTriggerSource,
  DreamSchedulerConfig,
  DreamRecord,
} from '@modules/dream/types';
export { DEFAULT_DREAM_SCHEDULER_CONFIG } from '@modules/dream/types';

// D1-Step2：自主运行计划契约 + 执行 deny 规则
export {
  parseDreamPlan,
  validateDreamPlan,
  buildDreamPlanMarkdown,
  type DreamPlan,
  type DreamPlanMeta,
  type DreamPlanValidation,
} from '@modules/dream/plan/DreamPlanContract';
export {
  AUTONOMOUS_DENY_COMMAND_PREFIXES,
  AUTONOMOUS_DENY_TOOLS,
  isDeniedByAutonomousRules,
  isDeniedToolByAutonomousRules,
  checkAutonomousOperation,
} from '@modules/dream/execution/DreamDenyRules';
