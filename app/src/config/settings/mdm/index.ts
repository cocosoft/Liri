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
