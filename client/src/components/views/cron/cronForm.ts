/**
 * 新建定时任务表单的契约与初值（CronPage 拆分批 1，2026-11-18）
 *
 * 单独成文件的两个原因：
 * ① `react-refresh/only-export-components` —— 组件文件只应导出组件；
 * ② 初值 / 重置必须**单一真源**（拆分前 `CronPage` 里有两处相同字面量）。
 */
import type { ScheduleMode } from "../../../types";

/** 新建任务表单（与 `cronService.create` 的入参字段对齐） */
export interface CronFormState {
  name: string;
  expression: string;
  description: string;
  enabled: boolean;
  scheduleMode: ScheduleMode;
  silent: boolean;
  prompt: string;
  everyValue: number;
  everyUnit: "minutes" | "hours" | "days";
  atHour: string;
  atMinute: string;
  deliver: string;
  deliverTo: string;
  agentId: string;
  model: string;
  timezone: string;
}

/** 空白表单（初始值与取消后重置共用） */
export function createEmptyCronForm(): CronFormState {
  return {
    name: "",
    expression: "",
    description: "",
    enabled: true,
    scheduleMode: "cron",
    silent: false,
    prompt: "",
    everyValue: 30,
    everyUnit: "minutes",
    atHour: "14",
    atMinute: "00",
    deliver: "local",
    deliverTo: "",
    agentId: "",
    model: "",
    timezone: "",
  };
}
