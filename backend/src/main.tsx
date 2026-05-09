#!/usr/bin/env bun
/**
 * 应用主入口（已弃用）
 *
 * @deprecated 请使用 src/main.ts 的 launch() 函数
 * 所有运行模式通过 launch() 函数统一分发
 */

import { launch, LaunchMode } from './main';
import { parseRunMode } from './utils/cliArgs';

const runMode = parseRunMode();

const modeMap: Record<string, LaunchMode> = {
  mcp: LaunchMode.MCP,
  print: LaunchMode.CLI,
  pipe: LaunchMode.CLI,
  background: LaunchMode.DAEMON,
};

const mode = modeMap[runMode] || LaunchMode.REPL;
await launch({ mode, args: process.argv.slice(2) });
