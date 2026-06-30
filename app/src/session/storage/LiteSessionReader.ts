// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 轻量元数据读取工具
 *
 * 对标 BA_REF sessionStoragePortable.ts 的 extractJsonStringField()，
 * 只读文件头部 64KB，用字符串搜索提取基础字段（title/status/updatedAt），
 * 避免列表查询时全量加载 JSON 文件。
 */

import { readFileSync } from 'node:fs';

/** 头部读取大小（64KB） */
export const LITE_READ_BUF_SIZE = 65536;

/** 轻量元数据 */
export interface LiteSessionMeta {
  title?: string;
  status?: string;
  updatedAt?: string;
}

/**
 * 从 JSON 文本中提取字符串字段值（不解析整个 JSON）
 * 使用 "key":"value" 模式匹配，比 JSON.parse 快 5-10x。
 */
export function extractJsonStringField(
  raw: string,
  fieldName: string
): string | null {
  const regex = new RegExp(`"${fieldName}"\\s*:\\s*"([^"]*)"`, 'i');
  const match = raw.match(regex);
  return match ? match[1] : null;
}

/**
 * 从会话文件中提取轻量元数据
 * @param filePath JSON 会话文件路径
 * @returns 基础元数据或 null
 */
export function readLiteSessionMeta(filePath: string): LiteSessionMeta | null {
  try {
    // 只读头部 64KB
    const fd = require('node:fs').openSync(filePath, 'r');
    const buf = Buffer.alloc(LITE_READ_BUF_SIZE);
    require('node:fs').readSync(fd, buf, 0, LITE_READ_BUF_SIZE, 0);
    require('node:fs').closeSync(fd);
    const raw = buf.toString('utf-8');

    return {
      title: extractJsonStringField(raw, 'title') || undefined,
      status: extractJsonStringField(raw, 'status') || undefined,
      updatedAt: extractJsonStringField(raw, 'updatedAt') || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * 批量读取会话列表的轻量元数据
 * @param filePaths 会话文件路径数组
 * @returns 元数据数组（失败的文件返回 null 并跳过）
 */
export function readLiteSessionMetaBatch(
  filePaths: string[]
): (LiteSessionMeta | null)[] {
  return filePaths.map((p) => readLiteSessionMeta(p));
}
