/**
 * Chat File Slice — 文件预览与管理
 *
 * 管理会话中的文件列表和预览文件状态。
 * 使用 Zustand StateCreator 模式。
 */
import type { StateCreator } from "zustand";
import type { MessageBlock, ToolCall } from "../../types";
import type { FilePreview } from "../../types";
import { httpLegacy as http } from "../../services/httpClient";
import { resolveFilePath } from "../../services/filePathResolver";
import { handleClientError } from "@/utils/handleError";

/** 扩展名 → 文件类型映射表 */
export type FileType =
  | "code"
  | "text"
  | "image"
  | "markdown"
  | "json"
  | "yaml"
  | "pdf"
  | "docx"
  | "pptx";

const EXT_TO_TYPE: Record<string, FileType> = {
  // 文档
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "text",
  ".csv": "text",
  ".log": "text",
  // Office 文档（预览时需转换）
  ".pdf": "pdf",
  ".docx": "docx",
  ".pptx": "pptx",
  // 数据
  ".json": "json",
  ".jsonc": "json",
  ".json5": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "yaml",
  ".ini": "yaml",
  ".cfg": "yaml",
  ".xml": "code",
  // 前端
  ".ts": "code",
  ".tsx": "code",
  ".js": "code",
  ".jsx": "code",
  ".mjs": "code",
  ".cjs": "code",
  ".css": "code",
  ".scss": "code",
  ".less": "code",
  ".html": "code",
  ".htm": "code",
  // 后端
  ".py": "code",
  ".rs": "code",
  ".go": "code",
  ".java": "code",
  ".c": "code",
  ".cpp": "code",
  ".h": "code",
  ".hpp": "code",
  ".rb": "code",
  ".php": "code",
  ".swift": "code",
  ".kt": "code",
  ".scala": "code",
  ".sql": "code",
  ".sh": "code",
  ".bash": "code",
  ".ps1": "code",
  ".bat": "code",
  // 配置
  ".env": "text",
  ".gitignore": "text",
  ".dockerignore": "text",
  ".editorconfig": "text",
  // 矢量图形
  ".svg": "code",
  // 图片
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
  ".ico": "image",
  ".bmp": "image",
  ".tiff": "image",
};

/**
 * 从路径字符串中提取文件名
 */
export function extractFileName(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

/**
 * 根据文件扩展名推断文件类型（S0-5/6）
 * 用于后端返回 type="text" 或前端手工创建文件时的类型补正
 */
export function inferFileType(filePath: string): FileType {
  const lower = filePath.toLowerCase();
  for (const [ext, type] of Object.entries(EXT_TO_TYPE)) {
    if (lower.endsWith(ext)) {
      return type;
    }
  }
  return "text";
}

/**
 * 从工具调用中提取文件路径
 * 扫描所有工具的 arguments，提取 file_path/path/filePath 参数
 * @returns 文件路径字符串，若无匹配参数则返回 null
 */
export function extractFilePathFromToolCall(toolCall: ToolCall): string | null {
  const args = toolCall.arguments as Record<string, unknown> | undefined;
  if (!args) return null;

  const filePath =
    (args.file_path as string) ||
    (args.path as string) ||
    (args.filePath as string);
  if (filePath && typeof filePath === "string") return filePath;

  return null;
}

/**
 * 从工具调用结果中提取最精确的文件路径
 * 优先取 result 中的路径，fallback 到 arguments 中的路径
 */
export function resolveFilePathFromResult(toolCall: ToolCall): string | null {
  const argPath = extractFilePathFromToolCall(toolCall);
  if (!argPath) return null;

  if (toolCall.result && typeof toolCall.result === "object") {
    const result = toolCall.result as Record<string, unknown>;
    const resultPath =
      (result.filePath as string) ||
      (result.path as string) ||
      (result.file_path as string);
    if (resultPath && typeof resultPath === "string") return resultPath;
  }
  return argPath;
}

/**
 * 扫描 blocks 中的工具调用，提取文件路径并通过回调添加到文件列表
 * 异步解析文件路径并更新 store
 * @param blocks 消息块列表
 * @param addFile 添加文件的回调函数
 * @param getSessionFiles 获取当前文件列表的回调
 * @param setSessionFiles 设置文件列表的回调（用于异步路径解析）
 */
export function addFilePathsFromBlocks(
  blocks: MessageBlock[],
  addFile: (file: FilePreview) => void,
  getSessionFiles: () => FilePreview[],
  setSessionFiles: (files: FilePreview[]) => void,
): void {
  const pendingResolves: Array<{ filePath: string }> = [];

  for (const block of blocks) {
    if (block.type === "tool_call" && block.toolCall) {
      const filePath = resolveFilePathFromResult(block.toolCall);
      if (filePath) {
        addFile({
          path: filePath,
          name: extractFileName(filePath),
          content: "",
          type: inferFileType(filePath),
        });
        pendingResolves.push({ filePath });
      }
    }
  }

  // 批量异步解析，一次性更新 store——避免每个文件的 resolve 回调各触发一次 setState 导致 N 次重渲染
  if (pendingResolves.length > 0) {
    Promise.all(
      pendingResolves.map(({ filePath }) =>
        resolveFilePath(filePath).then((resolvedPath) => ({
          filePath,
          resolvedPath,
        })),
      ),
    )
      .then((results) => {
        const currentFiles = getSessionFiles();
        let changed = false;
        const updated = [...currentFiles];

        for (const { filePath, resolvedPath } of results) {
          if (resolvedPath && resolvedPath !== filePath) {
            const idx = updated.findIndex((f) => f.path === filePath);
            if (idx !== -1) {
              updated[idx] = {
                ...updated[idx],
                path: resolvedPath,
                name: extractFileName(resolvedPath),
              };
              changed = true;
            }
          }
        }

        if (changed) {
          setSessionFiles(updated);
        }
      })
      .catch((e) => {
        handleClientError(
          e,
          { module: "stores:chat:file", action: "addFilePaths:batchResolve" },
          "warn",
        );
      });
  }
}

/** File Slice 状态和操作 */
export interface FileSlice {
  /** 当前预览的文件 */
  previewFile: FilePreview | null;
  /** 当前会话中生成的文件列表 */
  sessionFiles: FilePreview[];
  /** 是否正在上传文件 */
  isUploading: boolean;

  /** 设置预览文件 */
  setPreviewFile: (file: FilePreview | null) => void;
  /** 添加生成的文件到列表（去重，单次一个文件） */
  addSessionFile: (file: FilePreview) => void;
  /** 批量设置文件列表（直接替换，不逐个触发渲染） */
  setSessionFiles: (files: FilePreview[]) => void;
  /** 清除会话文件列表 */
  clearSessionFiles: () => void;
  /** 读取文件内容并添加到预览 */
  readFileToPreview: (filePath: string) => Promise<void>;
}

/**
 * 创建 File Slice（Zustand StateCreator 模式）
 */
export const createFileSlice: StateCreator<FileSlice, [], [], FileSlice> = (
  set,
  get,
) => ({
  previewFile: null,
  sessionFiles: [],
  isUploading: false,

  setPreviewFile: (file) => {
    set({ previewFile: file });
  },

  addSessionFile: (file) => {
    const current = get().sessionFiles;
    const exists = current.some((f) => f.path === file.path);
    if (!exists) {
      set({ sessionFiles: [...current, file] });
    }
  },

  setSessionFiles: (files) => {
    set({ sessionFiles: files });
  },

  clearSessionFiles: () => {
    set({ sessionFiles: [], previewFile: null });
  },

  readFileToPreview: async (filePath: string) => {
    try {
      const resolvedPath = await resolveFilePath(filePath);

      // 如果解析后的路径与传入路径不一致,自动更新 sessionFiles 中的记录
      if (resolvedPath !== filePath) {
        const currentFiles = get().sessionFiles;
        const idx = currentFiles.findIndex((f) => f.path === filePath);
        if (idx !== -1) {
          const updated = [...currentFiles];
          updated[idx] = {
            ...updated[idx],
            path: resolvedPath,
            name: extractFileName(resolvedPath),
          };
          set({ sessionFiles: updated });
        }
      }

      const existing = get().sessionFiles.find((f) => f.path === resolvedPath);
      if (existing && existing.content) {
        set({ previewFile: existing });
        return;
      }

      const ext = resolvedPath.toLowerCase().split(".").pop();
      const isOfficeFile = ext === "pdf" || ext === "docx" || ext === "pptx";

      // Office 文件使用预览转换接口，其他文件使用普通读取接口
      const apiEndpoint = isOfficeFile ? "/api/file/preview" : "/api/file/read";
      const data = await http.get<{
        content: string;
        type: string;
        language?: string;
        size?: number;
      }>(apiEndpoint, { params: { path: resolvedPath } });
      const filePreview: FilePreview = {
        path: resolvedPath,
        name:
          resolvedPath.split("/").pop() ||
          resolvedPath.split("\\").pop() ||
          resolvedPath,
        content: data.content,
        type: (data.type && data.type !== "text"
          ? data.type
          : inferFileType(resolvedPath)) as FilePreview["type"],
        language: data.language,
        size: data.size,
      };
      // 如果 sessionFiles 中已有该文件（但 content 为空），替换其内容
      const currentFiles = get().sessionFiles;
      const existingIdx = currentFiles.findIndex(
        (f) => f.path === resolvedPath,
      );
      if (existingIdx !== -1) {
        const updated = [...currentFiles];
        updated[existingIdx] = filePreview;
        set({ sessionFiles: updated });
      } else {
        // 如果路径被后端纠正（resolvedPath !== filePath），尝试用原始路径查找并更新
        if (resolvedPath !== filePath) {
          const oldIdx = currentFiles.findIndex((f) => f.path === filePath);
          if (oldIdx !== -1) {
            const updated = [...currentFiles];
            updated[oldIdx] = filePreview;
            set({ sessionFiles: updated });
          } else {
            get().addSessionFile(filePreview);
          }
        } else {
          get().addSessionFile(filePreview);
        }
      }
      set({ previewFile: filePreview });
    } catch (err) {
      handleClientError(
        err,
        { module: "stores:chat:file", action: "readFileToPreview" },
        "warn",
      );
      set({
        previewFile: {
          path: filePath,
          name:
            filePath.split("/").pop() || filePath.split("\\").pop() || filePath,
          content: `错误: ${err instanceof Error ? err.message : String(err)}`,
          type: inferFileType(filePath),
        },
      });
    }
  },
});
