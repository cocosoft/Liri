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
//
/**
 * 诊断模块主入口
 */

export * from './DiagnosticsService';

// 2026-08-30 R03-002 收敛：infrastructure-diagnostics 统一出口
export { setupInfrastructureDiagnostics } from './infrastructure-diagnostics';

// 2026-09-22：事件循环阻塞探针（取证方案 §3 P1/P2）统一出口
export {
  loopProbe,
  onLoopLag,
  resetLoopProbeForTest,
  LoopProbe,
  LOOP_PROBE_DIR_NAME,
  renderSummaryMarkdown,
} from './loopProbe/loopProbe';
export type { LoopIncident, LoopProbeReport } from './loopProbe/loopProbe';
export {
  resolveProbeMode,
  summarizeProfile,
  initProbeState,
  decideOnLag,
  decideOnArmTimeout,
  DEFAULT_PROBE_CONFIG,
} from './loopProbe/loopProbeCore';
export type {
  ProbeMode,
  ProbeState,
  ProbeConfig,
  ProbeAction,
  ProfileSummary,
  ProfileHotspot,
  CpuProfileLike,
} from './loopProbe/loopProbeCore';
export {
  enterPhase,
  exitPhase,
  withPhase,
  withPhaseSync,
  currentPhase,
  recentPhases,
  snapshotPhases,
  resetPhaseStack,
  setPhaseStackEnabled,
  isPhaseStackEnabled,
} from './loopProbe/phaseStack';
export type { PhaseEntry, PhaseSnapshot } from './loopProbe/phaseStack';
