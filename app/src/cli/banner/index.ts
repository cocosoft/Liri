// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * CLI Banner
 * 对标OpenClaw cli/banner.ts
 * 版本/启动广播/横幅系统
 */

export interface BannerConfig {
  appName: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  showNodeVersion?: boolean;
  showPlatform?: boolean;
  showUptime?: boolean;
  colorize?: boolean;
}

export interface BannerSection {
  title: string;
  lines: string[];
}

const DEFAULT_CONFIG: Required<BannerConfig> = {
  appName: 'PY_APP',
  version: '1.0.0',
  description: '',
  author: '',
  homepage: '',
  showNodeVersion: true,
  showPlatform: true,
  showUptime: false,
  colorize: true,
};

const BANNER_ART: Record<string, string> = {
  default: `
██████╗ ██╗   ██╗     █████╗ ██████╗ ██████╗
██╔══██╗╚██╗ ██╔╝    ██╔══██╗██╔══██╗██╔══██╗
██████╔╝ ╚████╔╝     ███████║██████╔╝██████╔╝
██╔═══╝   ╚██╔╝      ██╔══██║██╔═══╝ ██╔═══╝
██║        ██║       ██║  ██║██║     ██║
╚═╝        ╚═╝       ╚═╝  ╚═╝╚═╝     ╚═╝
`,
};

export function generateBanner(config?: Partial<BannerConfig>): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const lines: string[] = [];

  const art = BANNER_ART.default;
  lines.push(art);

  const titleLine = `${cfg.appName} v${cfg.version}`;
  lines.push(titleLine);
  lines.push('');

  if (cfg.description) {
    lines.push(cfg.description);
    lines.push('');
  }

  const infoLines: string[] = [];

  if (cfg.showPlatform) {
    infoLines.push(`Platform: ${process.platform} ${process.arch}`);
  }

  if (cfg.showNodeVersion) {
    infoLines.push(`Runtime: ${process.version}`);
  }

  if (cfg.showUptime) {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    infoLines.push(`Uptime: ${hours}h ${minutes}m`);
  }

  if (infoLines.length > 0) {
    lines.push(infoLines.join('  ·  '));
    lines.push('');
  }

  if (cfg.author) {
    lines.push(`Author: ${cfg.author}`);
  }

  if (cfg.homepage) {
    lines.push(`Homepage: ${cfg.homepage}`);
  }

  return lines.join('\n');
}

export function generateMinimalBanner(config?: Partial<BannerConfig>): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  return `${cfg.appName} v${cfg.version}`;
}

export function generateBroadcastMessage(
  message: string,
  level?: 'info' | 'warning' | 'error' | 'success'
): string {
  const prefix = level ? `[${level.toUpperCase()}]` : '[INFO]';
  const separator = '='.repeat(Math.max(message.length, 40));
  return `\n${separator}\n${prefix} ${message}\n${separator}\n`;
}

export function generateSectionBanner(section: BannerSection): string {
  const lines: string[] = [];
  const titleLine = `── ${section.title} `;
  const separator = titleLine.padEnd(50, '─');

  lines.push('');
  lines.push(separator);
  for (const line of section.lines) {
    lines.push(`  ${line}`);
  }
  lines.push('');

  return lines.join('\n');
}

export function getVersionString(config?: Partial<BannerConfig>): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  return `${cfg.appName}/${cfg.version} ${process.platform}-${process.arch} ${process.version}`;
}
