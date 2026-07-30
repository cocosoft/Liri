/**
 * MIT License
 * Copyright (c) 2026 Liri
 *
 * 术语表管理器
 *
 * 维护用户自定义术语映射，在翻译 prompt 中注入术语约束。
 * 支持 JSON/CSV 导入导出，内存存储 + JSON 文件持久化。
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { resolveDataSubDir } from '../../core/paths';
import { Logger, LogLevel } from '../../monitoring/logs/Logger';
import { handleError } from '../../error/handleError';

const logger = new Logger({ level: LogLevel.INFO, module: 'ai:glossary' });
const MAX_GLOSSARY_ENTRIES = 200;

/** 术语条目 */
export interface GlossaryEntry {
  sourceLang: string;
  targetLang: string;
  sourceTerm: string;
  targetTerm: string;
}

export class GlossaryManager {
  private static instance: GlossaryManager;

  /** langPair → term mapping */
  private glossaries: Map<string, Map<string, string>> = new Map();
  private initialized = false;

  private constructor() {}

  static getInstance(): GlossaryManager {
    if (!GlossaryManager.instance) {
      GlossaryManager.instance = new GlossaryManager();
    }
    return GlossaryManager.instance;
  }

  /**
   * 从持久化文件加载术语表
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const filePath = this.getStoragePath();
      if (existsSync(filePath)) {
        const raw = readFileSync(filePath, 'utf-8');
        const entries: GlossaryEntry[] = JSON.parse(raw);

        for (const entry of entries) {
          this.addEntry(entry);
        }

        logger.info(`术语表已加载: ${entries.length} 条`);
      }
    } catch (err) {
      void handleError(err, {
        module: 'ai:glossary',
        action: 'loadGlossary',
      });
    }

    this.initialized = true;
  }

  /**
   * 添加单条术语
   */
  addEntry(entry: GlossaryEntry): void {
    const pairKey = this.pairKey(entry.sourceLang, entry.targetLang);

    if (!this.glossaries.has(pairKey)) {
      this.glossaries.set(pairKey, new Map());
    }

    const langGlossary = this.glossaries.get(pairKey)!;

    if (langGlossary.size >= MAX_GLOSSARY_ENTRIES) {
      logger.warning(`术语表已满 (${MAX_GLOSSARY_ENTRIES} 条)，忽略新条目`);
      return;
    }

    langGlossary.set(entry.sourceTerm, entry.targetTerm);
  }

  /**
   * 批量导入术语（JSON 格式）
   * @param sourceLang 源语言
   * @param targetLang 目标语言
   * @param entries 术语映射 { sourceTerm: targetTerm }
   */
  importJSON(
    sourceLang: string,
    targetLang: string,
    entries: Record<string, string>
  ): void {
    for (const [sourceTerm, targetTerm] of Object.entries(entries)) {
      this.addEntry({ sourceLang, targetLang, sourceTerm, targetTerm });
    }
  }

  /**
   * 批量导入术语（CSV 格式）
   * CSV 格式: sourceLang,targetLang,sourceTerm,targetTerm
   */
  importCSV(csv: string): number {
    const lines = csv.trim().split('\n');
    let count = 0;

    for (const line of lines) {
      // 跳过标题行
      if (line.startsWith('sourceLang,')) continue;

      const parts = line.split(',');
      if (parts.length < 4) continue;

      this.addEntry({
        sourceLang: parts[0].trim(),
        targetLang: parts[1].trim(),
        sourceTerm: parts[2].trim(),
        targetTerm: parts[3].trim(),
      });
      count++;
    }

    return count;
  }

  /**
   * 获取所有术语条目
   */
  getAllEntries(): GlossaryEntry[] {
    const result: GlossaryEntry[] = [];

    for (const [pairKey, terms] of this.glossaries) {
      const [sourceLang, targetLang] = pairKey.split(':');
      for (const [sourceTerm, targetTerm] of terms) {
        result.push({ sourceLang, targetLang, sourceTerm, targetTerm });
      }
    }

    return result;
  }

  /**
   * 构建术语表 prompt 注入文本
   *
   * 在 system prompt 之后、user message 之前插入，
   * 格式为 "Glossary: sourceTerm → targetTerm (one per line)"
   */
  buildGlossaryPrompt(sourceLang: string, targetLang: string): string {
    const pairKey = this.pairKey(sourceLang, targetLang);
    const langGlossary = this.glossaries.get(pairKey);

    if (!langGlossary || langGlossary.size === 0) {
      return '';
    }

    const lines: string[] = [
      '',
      'Use the following term translations (higher priority than general rules):',
    ];

    for (const [sourceTerm, targetTerm] of langGlossary) {
      lines.push(`  "${sourceTerm}" → "${targetTerm}"`);
    }

    return lines.join('\n');
  }

  /**
   * 移除某语言对的全部术语
   */
  removePair(sourceLang: string, targetLang: string): void {
    const pairKey = this.pairKey(sourceLang, targetLang);
    this.glossaries.delete(pairKey);
  }

  /**
   * 清空所有术语表
   */
  clear(): void {
    this.glossaries.clear();
  }

  /**
   * 获取术语表条目总数
   */
  get size(): number {
    let count = 0;
    for (const terms of this.glossaries.values()) {
      count += terms.size;
    }
    return count;
  }

  /**
   * 持久化到 JSON 文件
   */
  async save(): Promise<void> {
    try {
      const entries = this.getAllEntries();
      const filePath = this.getStoragePath();
      writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf-8');
      logger.info(`术语表已保存: ${entries.length} 条`);
    } catch (err) {
      void handleError(err, {
        module: 'ai:glossary',
        action: 'saveGlossary',
      });
    }
  }

  /**
   * 导出为 JSON 对象
   */
  exportJSON(sourceLang: string, targetLang: string): Record<string, string> {
    const pairKey = this.pairKey(sourceLang, targetLang);
    const langGlossary = this.glossaries.get(pairKey);

    if (!langGlossary) return {};

    const result: Record<string, string> = {};
    for (const [k, v] of langGlossary) {
      result[k] = v;
    }
    return result;
  }

  // ── 私有方法 ──────────────────────────────

  private pairKey(sourceLang: string, targetLang: string): string {
    return `${sourceLang}:${targetLang}`;
  }

  private getStoragePath(): string {
    const dataDir = resolveDataSubDir('glossary');
    return join(dataDir, 'glossary.json');
  }
}
