export { ModuleBridgeRuntime } from './ModuleBridgeRuntime.js';
export type { ModuleBridgeDependencies } from './ModuleBridgeRuntime.js';
export {
  initModuleBridge,
  type ModuleBridgeInitConfig,
} from './ModuleBridgeInit.js';
export { setupModuleBridgeOnStartup } from './ModuleBridgeSetup.js';

export * from './sessions';

export * from './BridgeMain.js';

// 2026-08-29 R03-002 收敛：state / utils / messaging 统一出口
export { bridgeStateStore } from './state/BridgeStateStore.js';
export type { BridgeState } from './state/BridgeStateStore.js';
export { readBridgeConfig } from './utils/bridgeConfig.js';
export type { BridgeMessage } from './messaging/BridgeMessaging.js';
export { createDummySpawner } from './sessions/MultiSessionManager.js';
