export interface FileEntry {
  name: string;
  /** 绝对路径（读/预览等物理操作使用） */
  path: string;
  /** P1-1（2026-09-07）：逻辑相对路径（相对文件管理器根视图，posix `/` 分隔，如 `attachments/sub`）。
   *  目录导航/上级计算/树高亮一律使用它，回传后端 `resolveStorePath` 可安全解析，避免绝对路径越权拦截。 */
  relPath?: string;
  type: "file" | "directory";
  size?: number;
  modified_at?: number;
  fileId?: string;
  md5?: string;
  source?: FileSource | string;
  storeZone?: StoreZone | string;
  mimeType?: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export type StoreZone = "inbound" | "media" | "artifact" | "notebook";

export type FileSource =
  | "upload"
  | "channel_telegram"
  | "channel_feishu"
  | "channel_dingtalk"
  | "channel_wecom"
  | "channel_wechat"
  | "channel_qq"
  | "channel_discord"
  | "channel_slack"
  | "channel_line"
  | "channel_irc"
  | "channel_nostr"
  | "channel_email"
  | "channel_sms"
  | "channel_webhook"
  | "channel_googlechat"
  | "channel_msteams"
  | "channel_zalo"
  | "channel_yuanbao"
  | "channel_whatsapp"
  | "channel_signal"
  | "channel_matrix"
  | "channel_facebook"
  | "channel_twitter"
  | "channel_claude"
  | "channel_mattermost"
  | "channel_bluebubbles"
  | "tool_write"
  | "tool_download"
  | "tool_generate"
  | "auto_ingest"
  | "artifact"
  | "notebook"
  | "archive_extracted";

export type FileCategory =
  | "all"
  | "output"
  | "downloads"
  | "attachments"
  | "knowledge"
  | "memory"
  | "inbound"
  | "media"
  | "artifact"
  | "notebook";

export interface FilePreview {
  path: string;
  name: string;
  content: string;
  type:
    | "code"
    | "html"
    | "markdown"
    | "json"
    | "yaml"
    | "image"
    | "text"
    | "pdf"
    | "docx"
    | "pptx"
    | "xlsx"
    | "audio"
    | "video"
    | "unsupported";
  language?: string;
  size?: number;
  /** 音视频文件的静态流 URL（/api/file/stream），供 <audio>/<video> 直接播放 */
  staticUrl?: string;
}

export interface FileRegistryRecord {
  id: number;
  fileId: string;
  originalName: string;
  savedName: string;
  savedPath: string;
  md5: string;
  size: number;
  mimeType: string;
  source: string;
  sourceId: string;
  storeZone: string;
  mediaType: string;
  category: string;
  description: string;
  isArchive: boolean;
  archiveParentId: string;
  isDeleted: boolean;
  /** 秒级时间戳（SQLite unixepoch；展示经 formatRegistryTime 换算 *1000） */
  createdAt: number;
  /** 秒级时间戳（同 createdAt） */
  updatedAt: number;
}

export interface FileSearchParams {
  query?: string;
  source?: FileSource | string;
  storeZone?: StoreZone | string;
  startDate?: string;
  endDate?: string;
  /** P2-1（2026-09-07）：offset 分页——传已加载条数（数字字符串），非后端游标 */
  cursor?: string;
  limit?: number;
}

export interface FileSearchResult {
  items: FileRegistryRecord[];
  /** 遗留字段：后端不再返回（P2-1 改 offset 分页），保留兼容 */
  nextCursor?: string;
  total: number;
  /** P2-1：是否还有更多（offset 分页，后端返回） */
  hasMore?: boolean;
}

export interface FileStats {
  totalFiles: number;
  totalSize: number;
  todayInbound: number;
  dedupSaved: number;
  dedupSize: number;
}
