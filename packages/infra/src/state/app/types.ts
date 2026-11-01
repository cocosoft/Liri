/**
 * 应用状态机类型定义
 *
 * 基于设计文档 7.1 节。
 * 表达全局应用级状态，共 4 种状态。
 */

import type { TransitionRules } from '../engine/types';

/**
 * 应用状态枚举
 *
 * 管理整个应用的全局生命周期。
 * ERROR 状态用于表达全局严重错误（如数据库断连、配置损坏）。
 */
export enum AppState {
  /** 空闲 */
  IDLE = 'idle',
  /** 忙碌 — 正在处理任务 */
  BUSY = 'busy',
  /** 暂停（主动） */
  PAUSED = 'paused',
  /** 出错（全局严重错误） */
  ERROR = 'error',
}

/**
 * 应用状态转移规则表
 */
export const APP_TRANSITIONS: TransitionRules<AppState> = {
  [AppState.IDLE]: [AppState.BUSY, AppState.PAUSED],
  [AppState.BUSY]: [AppState.IDLE, AppState.PAUSED, AppState.ERROR],
  [AppState.PAUSED]: [AppState.IDLE],
  [AppState.ERROR]: [AppState.IDLE, AppState.PAUSED],
};
