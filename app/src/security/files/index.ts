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
