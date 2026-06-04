/**
 * Cron 任务快速模板预设
 * 对标 OpenClaw-Admin CronPage template presets
 */

export interface CronTemplatePreset {
  id: string;
  labelKey: string;
  descriptionKey: string;
  scheduleMode: 'cron' | 'every' | 'at';
  cronExpr?: string;
  everyValue?: number;
  everyUnit?: 'minutes' | 'hours' | 'days';
  atHour?: string;
  atMinute?: string;
  silent?: boolean;
}

export const cronTemplates: CronTemplatePreset[] = [
  {
    id: 'morning-report',
    labelKey: 'cron.templateMorning',
    descriptionKey: 'cron.templateMorningDesc',
    scheduleMode: 'cron',
    cronExpr: '0 8 * * *',
  },
  {
    id: 'heartbeat-check',
    labelKey: 'cron.templateHeartbeat',
    descriptionKey: 'cron.templateHeartbeatDesc',
    scheduleMode: 'every',
    everyValue: 30,
    everyUnit: 'minutes',
  },
  {
    id: 'evening-summary',
    labelKey: 'cron.templateEvening',
    descriptionKey: 'cron.templateEveningDesc',
    scheduleMode: 'cron',
    cronExpr: '0 21 * * *',
  },
  {
    id: 'hourly-check',
    labelKey: 'cron.templateHourly',
    descriptionKey: 'cron.templateHourlyDesc',
    scheduleMode: 'every',
    everyValue: 1,
    everyUnit: 'hours',
    silent: true,
  },
  {
    id: 'weekday-morning',
    labelKey: 'cron.templateWeekdayMorning',
    descriptionKey: 'cron.templateWeekdayMorningDesc',
    scheduleMode: 'cron',
    cronExpr: '0 9 * * 1-5',
  },
];
