// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 轻量元数据读取工具
 *
 * 对标 BA_REF sessionStoragePortable.ts 的 extractJsonStringField()，
 * 只读文件头部 64KB，用字符串搜索提取基础字段（title/status/updatedAt），
 * 避免列表查询时全量加载 JSON 文件。
 */

import { readFileSync } from 'fs';

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
 *
 * P2-31 修复：原正则 `"([^"]*)"` 遇到转义引号（`\"`）会截断、反斜杠（`\\`）会错位，
 * 改为 `(?:\\.|[^"\\])*` 正确处理字符串内部的转义字符。
 */
export function extractJsonStringField(
  raw: string,
  fieldName: string
): string | null {
  const regex = new RegExp(
    `"${fieldName}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`,
    'i'
  );
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
    // 只读头部 64KB（KB-LITE-FD：readSync 抛错时 fd 必须关闭，否则批量读 N 会话
    // 泄漏 fd 最终触发 EMFILE——open/read 包 try/finally）
    const fsMod = require('fs');
    const fd = fsMod.openSync(filePath, 'r');
    let buf: Buffer;
    try {
      buf = Buffer.alloc(LITE_READ_BUF_SIZE);
      fsMod.readSync(fd, buf, 0, LITE_READ_BUF_SIZE, 0);
    } finally {
      fsMod.closeSync(fd);
    }
    const raw = buf.toString('utf-8');

    const title = extractJsonStringField(raw, 'title');
    const status = extractJsonStringField(raw, 'status');
    const updatedAt = extractJsonStringField(raw, 'updatedAt');

    // P2-31 修复：头部 64KB 未覆盖全部字段（messages 数组在前等布局）或字段为
    // 非字符串值（数字时间戳）时，回退全量 JSON.parse，防止列表元数据静默缺失。
    if (title === null || status === null || updatedAt === null) {
      const full = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<
        string,
        unknown
      >;
      return {
        title:
          title ?? (full['title'] != null ? String(full['title']) : undefined),
        status:
          status ??
          (full['status'] != null ? String(full['status']) : undefined),
        updatedAt:
          updatedAt ??
          (full['updatedAt'] != null ? String(full['updatedAt']) : undefined),
      };
    }

    return {
      title: title || undefined,
      status: status || undefined,
      updatedAt: updatedAt || undefined,
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
