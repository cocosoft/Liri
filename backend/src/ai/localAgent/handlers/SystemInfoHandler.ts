import os from 'os';
import type { QAHandler } from '../SimpleQAEngine.js';

export class SystemInfoHandler implements QAHandler {
  name = 'SystemInfoHandler';
  priority = 80;
  patterns = [
    /(当前|工作|所在).*(目录|路径|文件夹|位置)/i,
    /\b(pwd|cwd|current.?dir|current.?path)\b/i,
    /(系统|操作系统|OS).*(信息|名称|版本|类型)/i,
    /(主机名|hostname|计算机名|电脑名)/i,
    /(cpu|处理器|内存|memory|ram|运行|uptime)/i,
  ];

  handle(input: string): { response: string; confidence: number } | null {
    const lower = input.toLowerCase();

    if (
      lower.includes('目录') ||
      lower.includes('pwd') ||
      lower.includes('cwd') ||
      lower.includes('current dir') ||
      lower.includes('current path')
    ) {
      return {
        response: `当前工作目录：${process.cwd()}`,
        confidence: 0.9,
      };
    }

    if (
      lower.includes('系统') ||
      lower.includes('操作系统') ||
      lower.includes('os')
    ) {
      return {
        response: `操作系统：${os.type()} ${os.release()} (${os.platform()})`,
        confidence: 0.9,
      };
    }

    if (
      lower.includes('主机名') ||
      lower.includes('hostname') ||
      lower.includes('计算机名') ||
      lower.includes('电脑名')
    ) {
      return {
        response: `主机名：${os.hostname()}`,
        confidence: 0.9,
      };
    }

    if (lower.includes('cpu') || lower.includes('处理器')) {
      return {
        response: `CPU：${os.cpus().length} 核 ${os.cpus()[0]?.model || 'Unknown'}`,
        confidence: 0.85,
      };
    }

    if (
      lower.includes('memory') ||
      lower.includes('内存') ||
      lower.includes('ram')
    ) {
      const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
      const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(1);
      return {
        response: `内存：总计 ${totalMem} GB，可用 ${freeMem} GB`,
        confidence: 0.85,
      };
    }

    if (lower.includes('uptime') || lower.includes('运行')) {
      const uptimeSeconds = os.uptime();
      const days = Math.floor(uptimeSeconds / 86400);
      const hours = Math.floor((uptimeSeconds % 86400) / 3600);
      const minutes = Math.floor((uptimeSeconds % 3600) / 60);
      return {
        response: `系统已运行：${days} 天 ${hours} 小时 ${minutes} 分钟`,
        confidence: 0.85,
      };
    }

    return null;
  }
}
