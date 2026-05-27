import type { QAHandler } from '../SimpleQAEngine.js';

export class DateTimeHandler implements QAHandler {
  name = 'DateTimeHandler';
  priority = 100;
  patterns = [
    /(现在|当前|目前).*(时间|几点|时辰)/i,
    /\b(时间|几点|时辰)\b/i,
    /(今天|当前|现在).*(日期|几号|星期|周)/i,
    /\b(日期|星期|周[一二三四五六日天]|周[1-7])\b/i,
    /(现在|当前).*(是|什么).*(时间|日期|时候)/i,
  ];

  handle(_input: string): { response: string; confidence: number } | null {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const dateStr = now.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    });

    return {
      response: `当前时间：${dateStr} ${timeStr}`,
      confidence: 0.95,
    };
  }
}
