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
export {
  PromptInjectionDetector,
  getPromptInjectionDetector,
  resetPromptInjectionDetector,
} from './PromptInjectionDetector';
export type {
  InjectionSeverity,
  InjectionDetectionResult,
  DetectionLevel,
  DetectionResult,
  ThreatMatch,
  InvisibleCharMatch,
} from './PromptInjectionDetector';
export { UnicodeSanitizer, getUnicodeSanitizer } from './UnicodeSanitizer';
export type { UnicodeSanitizeResult } from './UnicodeSanitizer';
// CS01 归一化（2026-10-07）：不可见 Unicode **单一事实源**（供 chronos 等复用，禁止再建副本）
export {
  INVISIBLE_UNICODE_RANGES,
  isInvisibleCodePoint,
  containsInvisibleChars,
  countInvisibleChars,
} from './UnicodeSanitizer';
export type { InvisibleUnicodeRange } from './UnicodeSanitizer';
export {
  ContextFileScanner,
  getContextFileScanner,
} from './ContextFileScanner';
export type { ContextFileType, ContextFileEntry } from './ContextFileScanner';
