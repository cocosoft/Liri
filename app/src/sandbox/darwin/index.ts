// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// macOS Seatbelt（`sandbox-exec`）兜底沙箱的模块出口。
// 方案：`.trae/specs/macos-sandbox-exec.md`（首版只做写隔离）。
export {
  MACOS_SANDBOX_EXEC_PATH,
  detectMacOSSandboxCapability,
  clearMacOSSandboxCapabilityCache,
} from './MacOSSandboxDetector';
export type { MacOSSandboxCapability } from './MacOSSandboxDetector';
export {
  buildMacOSSandboxProfile,
  escapeSbplString,
} from './MacOSSandboxPolicy';
export type { MacOSSandboxProfileInput } from './MacOSSandboxPolicy';
