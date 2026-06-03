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
 * DreamPersistence — 梦境持久化
 *
 * 记录梦境执行历史，用于判断最短间隔等调度决策。
 */

import { resolveDataSubDir } from '@modules/config/paths';
import { join } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import type { DreamRecord } from './types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

const DREAM_RECORDS_FILE = 'dream_records.json';
const MAX_RECORDS = 50;

export class DreamPersistence {
  private records: DreamRecord[] = [];
  private storagePath: string;
  private loaded = false;

  constructor() {
    this.storagePath = join(resolveDataSubDir('dream'), DREAM_RECORDS_FILE);
  }

  /** 加载记录 */
  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      await mkdir(join(resolveDataSubDir('dream')), { recursive: true });
      const data = await readFile(this.storagePath, 'utf-8');
      this.records = JSON.parse(data);
      this.loaded = true;
      logger.info(
        `[DreamPersistence] 已加载 ${this.records.length} 条梦境记录`
      );
    } catch {
      this.records = [];
      this.loaded = true;
    }
  }

  /** 保存记录 */
  async save(record: DreamRecord): Promise<void> {
    await this.load();
    this.records.push(record);
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(-MAX_RECORDS);
    }
    try {
      await writeFile(
        this.storagePath,
        JSON.stringify(this.records, null, 2),
        'utf-8'
      );
    } catch (e) {
      logger.error(
        '[DreamPersistence] 保存记录失败',
        e instanceof Error ? e : new Error(String(e))
      );
    }
  }

  /** 获取上次梦境完成时间（毫秒时间戳），若无则返回 0 */
  getLastCompletedAt(): number {
    const completed = this.records
      .filter((r) => r.success)
      .sort((a, b) => b.completedAt - a.completedAt);
    return completed.length > 0 ? completed[0].completedAt : 0;
  }

  /** 获取所有记录 */
  getAllRecords(): DreamRecord[] {
    return [...this.records];
  }
}
