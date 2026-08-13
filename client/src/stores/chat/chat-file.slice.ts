/**
 * Chat File Slice — 文件预览与管理
 *
 * 管理会话中的文件列表和预览文件状态。
 * 使用 Zustand StateCreator 模式。
 */
import type { StateCreator } from "zustand";
import type { MessageBlock, ToolCall } from "@/types";
import type { FilePreview } from "@/types";
import { httpLegacy as http } from "@/services/httpClient";
import { resolveFilePath } from "@/services/filePathResolver";
import { handleClientError } from "@/utils/handleError";
import { createLogger } from "@/utils/logger";
import { useChatInspectorStore } from "@/stores/chatInspectorStore";

const logger = createLogger("stores:chat:file");

/** 扩展名 → 文件类型映射表 */
export type FileType =
  | "code"
  | "text"
  | "image"
  | "markdown"
  | "json"
  | "yaml"
  | "xlsx"
  | "pdf"
  | "docx"
  | "pptx"
  | "audio"
  | "video"
  | "unsupported";

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
  ".xlsx": "xlsx",
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
  // 图片
  ".svg": "image",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
  ".ico": "image",
  ".bmp": "image",
  ".tiff": "image",
  // 音频
  ".mp3": "audio",
  ".wav": "audio",
  ".ogg": "audio",
  ".aac": "audio",
  ".m4a": "audio",
  ".flac": "audio",
  // 视频
  ".mp4": "video",
  ".webm": "video",
  ".mov": "video",
  ".avi": "video",
  ".mkv": "video",
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
  for (const ext of BINARY_EXTS) {
    if (lower.endsWith(ext)) return "unsupported";
  }
  return "unsupported";
}

/** 二进制/不可预览文件的扩展名（防止误当作文本渲染导致乱码） */
const BINARY_EXTS: string[] = [
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".zip",
  ".tar",
  ".gz",
  ".7z",
  ".rar",
  ".bin",
  ".dat",
  ".wasm",
  ".class",
  ".pyc",
];

/**
 * 从工具调用中提取文件路径
 * 扫描所有工具的 arguments，提取 file_path/path/filePath 参数
 * @returns 文件路径字符串，若无匹配参数则返回 null
 */
export function extractFilePathFromToolCall(toolCall: ToolCall): string | null {
  const args = toolCall.arguments as Record<string, unknown> | undefined;
  if (!args) return null;

  // 语义明确的文件参数（file_path/filePath）直接信任
  const explicit = (args.file_path as string) || (args.filePath as string);
  if (explicit && typeof explicit === "string") return explicit;

  // 次要7 修复：泛化 path 参数可能是目录（如 outputDir），
  // 仅当带文件扩展名时才视为文件，避免目录路径进入 sessionFiles 渲染成损坏链接
  const pathArg = args.path as string;
  if (
    pathArg &&
    typeof pathArg === "string" &&
    /\.[a-zA-Z0-9]{1,10}$/.test(pathArg)
  ) {
    return pathArg;
  }

  return null;
}

/**
 * 从工具调用结果中提取最精确的文件路径
 * 优先取 result 中的路径（含嵌套 data.filePath），fallback 到 arguments 中的路径
 */
export function resolveFilePathFromResult(toolCall: ToolCall): string | null {
  // 先尝试从 result 中提取（支持嵌套 data.filePath / data.path）
  if (toolCall.result && typeof toolCall.result === "object") {
    const result = toolCall.result as Record<string, unknown>;
    const data = result.data as Record<string, unknown> | undefined;

    const resultPath =
      (result.filePath as string) ||
      (result.path as string) ||
      (result.file_path as string) ||
      (data?.filePath as string) ||
      (data?.path as string) ||
      (data?.file_path as string);
    if (resultPath && typeof resultPath === "string") return resultPath;
  }

  // fallback 到 arguments 中的路径
  return extractFilePathFromToolCall(toolCall);
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
          size: undefined,
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
  /** 正在加载预览的文件路径（防止快速点击并发的竞态） */
  pendingPreview: string | undefined;

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
  pendingPreview: undefined,

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
    set({ sessionFiles: [], previewFile: null, pendingPreview: undefined });
  },

  readFileToPreview: async (filePath: string) => {
    // 竞态防护：同一文件正在加载中则跳过
    const { pendingPreview } = get();
    if (pendingPreview === filePath) return;
    set({ pendingPreview: filePath });

    // 修复：交叉竞态（快速点 A 再点 B，A 响应后到会覆盖 B）——
    // 响应返回时校验 pendingPreview 仍等于本次 filePath 才写入 previewFile，
    // 已被更新请求取代的过期响应直接丢弃。
    const commitPreview = (file: FilePreview) => {
      if (get().pendingPreview !== filePath) {
        // 排查交叉竞态：过期响应（用户已改看其他文件）被丢弃
        logger.warn("readFileToPreview: 过期响应丢弃（交叉竞态防护）", {
          staleFile: filePath,
          currentPending: get().pendingPreview,
        });
        return;
      }
      set({ previewFile: file, pendingPreview: undefined });
    };

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
      // 文本类文件：有 content 即可复用缓存
      if (existing && existing.content) {
        commitPreview(existing);
        return;
      }
      // 客户端直渲/流播放类文件：content 始终为空，但有 staticUrl 或已渲染过即可复用
      const clientRenderedTypes = ["docx", "xlsx", "pptx", "audio", "video"];
      if (existing && clientRenderedTypes.includes(existing.type)) {
        commitPreview(existing);
        return;
      }

      const ext = resolvedPath.toLowerCase().split(".").pop();
      const inferredType = inferFileType(resolvedPath);

      // 不支持预览的格式：直接返回，不调后端 API
      if (inferredType === "unsupported") {
        const filePreview: FilePreview = {
          path: resolvedPath,
          name: extractFileName(resolvedPath),
          content: "",
          type: "unsupported",
        };
        commitPreview(filePreview);
        useChatInspectorStore.getState().setOpen(true);
        useChatInspectorStore.getState().setActiveTab("files");
        return;
      }

      // 音视频文件：使用静态流 URL 播放，不通过 /api/file/read 读取内容
      if (inferredType === "audio" || inferredType === "video") {
        const { getBackendBaseUrl } = await import("../../services/backendUrl");
        const staticUrl = `${getBackendBaseUrl()}/api/file/stream?path=${encodeURIComponent(resolvedPath)}`;
        const filePreview: FilePreview = {
          path: resolvedPath,
          name: extractFileName(resolvedPath),
          content: "",
          type: inferredType,
          staticUrl,
        };
        commitPreview(filePreview);
        useChatInspectorStore.getState().setOpen(true);
        useChatInspectorStore.getState().setActiveTab("files");
        return;
      }

      // 客户端直渲 Office 文件（docx/xlsx/pptx）：不调后端 API，由 OfficePreview 自行下载二进制
      if (
        inferredType === "docx" ||
        inferredType === "xlsx" ||
        inferredType === "pptx"
      ) {
        const filePreview: FilePreview = {
          path: resolvedPath,
          name: extractFileName(resolvedPath),
          content: "",
          type: inferredType,
        };
        commitPreview(filePreview);
        useChatInspectorStore.getState().setOpen(true);
        useChatInspectorStore.getState().setActiveTab("files");
        return;
      }

      const isOfficeFile = ext === "pdf";

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
      commitPreview(filePreview);
      useChatInspectorStore.getState().setOpen(true);
      useChatInspectorStore.getState().setActiveTab("files");
    } catch (err) {
      handleClientError(
        err,
        { module: "stores:chat:file", action: "readFileToPreview" },
        "warn",
      );
      commitPreview({
        path: filePath,
        name:
          filePath.split("/").pop() || filePath.split("\\").pop() || filePath,
        content: `错误: ${err instanceof Error ? err.message : String(err)}`,
        type: inferFileType(filePath),
      });
    }
  },
});
