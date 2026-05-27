/**
 * 慢操作检测系统
 * 用于检测和记录执行时间超过阈值的操作
 */

// 导出新的慢操作检测实现
export * from '../performance/SlowOperations.js';

// 保持向后兼容性
import * as SlowOperations from '../performance/SlowOperations.js';
export const jsonStringify = SlowOperations.jsonStringify;
