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
 * MDM设置模块导出
 */

export {
  MACOS_PREFERENCE_DOMAIN,
  WINDOWS_REGISTRY_KEY_PATH_HKLM,
  WINDOWS_REGISTRY_KEY_PATH_HKCU,
  WINDOWS_REGISTRY_VALUE_NAME,
  PLUTIL_PATH,
  PLUTIL_ARGS_PREFIX,
  MDM_SUBPROCESS_TIMEOUT_MS,
  getMacOSPlistPaths,
} from './constants.js';

export {
  fireRawRead,
  startMdmRawRead,
  getMdmRawReadPromise,
  type RawReadResult,
} from './rawRead.js';

export {
  startMdmSettingsLoad,
  ensureMdmSettingsLoaded,
  getMdmSettings,
  getHkcuSettings,
  clearMdmSettingsCache,
  setMdmSettingsCache,
  refreshMdmSettings,
  parseCommandOutputAsSettings,
  parseRegQueryStdout,
  type MdmResult,
} from './settings.js';
