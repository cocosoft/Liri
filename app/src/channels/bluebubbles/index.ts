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
 * channels/bluebubbles/index.ts - BlueBubbles 通道导出
 */

export {
  bluebubblesChannel,
  createBlueBubblesChannel,
  bluebubblesChannelPlugin,
} from './BlueBubblesChannel.js';

export {
  getDefaultBlueBubblesConfig,
  validateBlueBubblesConfig,
} from './config-schema.js';
export type { BlueBubblesConfig } from './config-schema.js';

export {
  registerBlueBubblesAccount,
  getBlueBubblesAccount,
  resolveBlueBubblesAccount,
  listBlueBubblesAccountIds,
  removeBlueBubblesAccount,
} from './accounts.js';
export type {
  BlueBubblesAccount,
  ResolvedBlueBubblesAccount,
} from './accounts.js';

export { BlueBubblesMonitor } from './monitor.js';
export {
  BLUEBUBBLES_TOOL_HINTS,
  buildBlueBubblesContext,
} from './channel.runtime.js';
export type { BlueBubblesRuntimeContext } from './channel.runtime.js';
export { diagnoseBlueBubbles } from './doctor.js';
export type {
  DiagnosisResult as BlueBubblesDiagnosisResult,
  DiagnosisCheck as BlueBubblesDiagnosisCheck,
  BlueBubblesDiagnosisContext,
} from './doctor.js';
export type { BlueBubblesProbe } from './probe.js';
