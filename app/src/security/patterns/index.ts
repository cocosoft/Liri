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
 * 安全模式导出
 */

export {
  DANGEROUS_COMMAND_PATTERNS,
  DANGEROUS_BASE_COMMANDS,
} from './dangerousCommands';
export {
  INJECTION_PATTERNS,
  IFS_INJECTION_PATTERNS,
  ENV_INJECTION_PATTERNS,
} from './injectionPatterns';
export {
  ZSH_SPECIFIC_PATTERNS,
  ZSH_DANGEROUS_COMMANDS,
  PRIVILEGE_ESCALATION_COMMANDS,
  SPECIAL_CHAR_PATTERNS,
} from './shellSpecific';
export {
  SecurityPatternUpdater,
  getSecurityPatternUpdater,
} from './SecurityPatternUpdater';
export type {
  SecurityPatternEntry,
  PatternUpdateEvent,
  PatternLibraryConfig,
} from './SecurityPatternUpdater';
