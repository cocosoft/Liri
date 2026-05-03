/**
 * 实例管理模块
 * 管理Ink应用实例
 */

import type { InkInstance } from './types';

// 用于 root.ts 的默认导出
const instancesMap = new Map<NodeJS.WriteStream, { cleanup: () => void }>();

// 用于其他文件的实例集合
const instances = new Set<InkInstance>();

export function registerInstance(instance: InkInstance): void {
  instances.add(instance);
}

export function unregisterInstance(instance: InkInstance): void {
  instances.delete(instance);
}

export function getInstances(): InkInstance[] {
  return Array.from(instances);
}

export function getInstanceById(id: string): InkInstance | undefined {
  return Array.from(instances).find((inst) => inst.id === id);
}

export function hasInstance(id: string): boolean {
  return Array.from(instances).some((inst) => inst.id === id);
}

export function getActiveInstance(): InkInstance | undefined {
  return Array.from(instances).find((inst) => inst.isActive);
}

export function setActiveInstance(id: string): void {
  for (const instance of instances) {
    instance.isActive = instance.id === id;
  }
}

export function destroyAllInstances(): void {
  for (const instance of instances) {
    instance.cleanup?.();
  }
  instances.clear();
}

export function countInstances(): number {
  return instances.size;
}

// 默认导出，用于 root.ts
export default instancesMap;