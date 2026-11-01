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
 * 文件安全模块导出
 * 对标 Hermes agent/file_safety.py
 */
export {
  PROTECTED_FILES,
  PROTECTED_DIRECTORY_PREFIXES,
  getCrossPlatformProtectedFiles,
  getCrossPlatformProtectedDirectoryPrefixes,
  isProtectedFile,
  isProtectedDirectory,
  isWriteProtected,
  getWriteProtectionReason,
} from './ProtectedPaths';
export {
  WriteSafeRoot,
  getWriteSafeRoot,
  resetWriteSafeRoot,
  WRITE_SAFE_ROOT_ENV,
} from './WriteSafeRoot';
export {
  ReadProtectionService,
  getReadProtectionService,
  resetReadProtectionService,
  INTERNAL_CACHE_PATTERNS,
  SENSITIVE_CONFIG_FILES,
} from './ReadProtectionService';
