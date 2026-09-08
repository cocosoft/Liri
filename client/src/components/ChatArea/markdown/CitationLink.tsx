import React, { useCallback, useState } from "react";
import { createLogger } from "@/utils/logger";
import type { ParsedCitation } from "../../../utils/citation";
import { openLocalFile } from "../../../services/fileOpenService";
import { resolveFilePath } from "../../../services/filePathResolver";

const logger = createLogger("components:citationLink");

interface CitationLinkProps {
  citation: ParsedCitation;
  /** 会话已知本地文件路径列表（聊天附件等），命中时直接打开该文件 */
  knownFilePaths?: string[];
}

/** 跨平台 basename（支持 / 与 \） */
function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

/** 把引用文件名解析为可打开的本地路径（优先已知路径；其次后端 resolve） */
async function resolveCandidatePath(
  file: string,
  knownFilePaths?: string[],
): Promise<string> {
  // 引用自带目录/绝对形态 → 直接使用
  if (file.includes("/") || file.includes("\\")) return file;
  // 与已知会话文件同名 → 直接用其绝对路径
  if (knownFilePaths && knownFilePaths.length > 0) {
    const lower = basename(file).toLowerCase();
    const hit = knownFilePaths.find((p) => basename(p).toLowerCase() === lower);
    if (hit) return hit;
  }
  // 未知路径走后端 resolve（白名单 baseDir + ~ 展开）
  try {
    return await resolveFilePath(file);
  } catch {
    return file;
  }
}

/**
 * R5 引用锚点：doc.pdf#p.12 / file.md#L42-L58 → 点击打开本地文件定位。
 */
function CitationLink({ citation, knownFilePaths }: CitationLinkProps) {
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);

  const locationLabel = citation.page
    ? `第 ${citation.page} 页` +
      (citation.section ? `·${citation.section}` : "")
    : citation.lineFrom
      ? `第 ${citation.lineFrom} 行` +
        (citation.lineTo && citation.lineTo !== citation.lineFrom
          ? `-${citation.lineTo}`
          : "")
      : "";

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (opening) return;
      setOpening(true);
      setFailed(false);
      try {
        const target = await resolveCandidatePath(
          citation.file,
          knownFilePaths,
        );
        await openLocalFile(target);
      } catch (err) {
        logger.error("打开引用文件失败", err);
        setFailed(true);
        setTimeout(() => setFailed(false), 3000);
      } finally {
        setOpening(false);
      }
    },
    [citation.file, knownFilePaths, opening],
  );

  return (
    <a
      href="#"
      onClick={handleClick}
      title={
        failed
          ? "打开失败：本地路径不可用或已被移动"
          : `打开本地文件${locationLabel ? `（${locationLabel}）` : ""}`
      }
      className={`inline cursor-pointer underline decoration-dotted underline-offset-2 ${
        failed
          ? "text-red-500 dark:text-red-400"
          : opening
            ? "text-gray-400 dark:text-gray-500"
            : "text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
      }`}
    >
      {citation.file}#{citation.ref}
    </a>
  );
}

export default React.memo(CitationLink);
