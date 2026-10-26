// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Windows 兜底沙箱（Low IL + Job Object）模块出口。方案：.trae/specs/windows-sandbox.md
export {
  WIN_SANDBOX_HELPER_BIN_NAME,
  WIN_SANDBOX_HELPER_ENV,
  resolveWinSandboxHelperCandidates,
  resolveWinSandboxHelperPath,
} from './helperPaths';
export {
  detectWindowsSandboxCapability,
  clearWindowsSandboxCapabilityCache,
} from './WindowsSandboxDetector';
export type { WindowsSandboxCapability } from './WindowsSandboxDetector';
export {
  WIN_SANDBOX_EXIT,
  buildWinSandboxArgv,
  classifyWinSandboxExit,
  runWithWinSandbox,
} from './runWithWinSandbox';
export type {
  WinSandboxRunInput,
  WinSandboxRunResult,
} from './runWithWinSandbox';
