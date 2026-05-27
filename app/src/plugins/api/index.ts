/**
 * 插件API导出
 * 整合 IPluginAPI、PluginAPIImpl、KernelServiceRegistry 等核心API组件
 */

export { PluginAPIImpl, createPluginAPI } from './PluginAPI.js';
export type { IPluginAPI } from './PluginAPI.js';
export {
  KernelServiceRegistry,
  KernelServiceId,
  getKernelServiceRegistry,
  resetKernelServiceRegistry,
} from './KernelServiceRegistry.js';
export type { ServiceAccessEntry } from './KernelServiceRegistry.js';
