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
 * channels/mattermost/index.ts - Mattermost 通道导出
 */

export {
  mattermostChannel,
  createMattermostChannel,
  mattermostChannelPlugin,
} from './MattermostChannel.js';

export {
  getDefaultMattermostConfig,
  validateMattermostConfig,
} from './config-schema.js';
export type { MattermostConfig } from './config-schema.js';

export {
  registerMattermostAccount,
  getMattermostAccount,
  resolveMattermostAccount,
  listMattermostAccountIds,
  removeMattermostAccount,
} from './accounts.js';
export type {
  MattermostAccount,
  ResolvedMattermostAccount,
} from './accounts.js';

export { MattermostMonitor } from './monitor.js';
export {
  MATTERMOST_TOOL_HINTS,
  buildMattermostContext,
} from './channel.runtime.js';
export type { MattermostRuntimeContext } from './channel.runtime.js';
export { diagnoseMattermost } from './doctor.js';
export type {
  DiagnosisResult as MattermostDiagnosisResult,
  DiagnosisCheck as MattermostDiagnosisCheck,
  MattermostDiagnosisContext,
} from './doctor.js';
export type { MattermostProbe } from './probe.js';
