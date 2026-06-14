export interface FileEntry {
  name: string;
  path: string;
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

export type StoreZone = 'inbound' | 'media' | 'artifact' | 'notebook';

export type FileSource =
  | 'upload'
  | 'channel_telegram' | 'channel_feishu' | 'channel_dingtalk'
  | 'channel_wecom' | 'channel_wechat' | 'channel_qq'
  | 'channel_discord' | 'channel_slack' | 'channel_line'
  | 'channel_irc' | 'channel_nostr' | 'channel_email'
  | 'channel_sms' | 'channel_webhook' | 'channel_googlechat'
  | 'channel_msteams' | 'channel_zalo' | 'channel_yuanbao'
  | 'channel_whatsapp' | 'channel_signal' | 'channel_matrix'
  | 'channel_facebook' | 'channel_twitter' | 'channel_claude'
  | 'channel_mattermost' | 'channel_bluebubbles'
  | 'tool_write' | 'tool_download' | 'tool_generate'
  | 'auto_ingest' | 'artifact' | 'notebook' | 'archive_extracted';

export type FileCategory = "all" | "output" | "downloads" | "attachments" | "knowledge" | "memory" | "inbound" | "media" | "artifact" | "notebook";

export interface FilePreview {
  path: string;
  name: string;
  content: string;
  type: "code" | "markdown" | "json" | "yaml" | "image" | "text" | "pdf" | "docx" | "pptx";
  language?: string;
  size?: number;
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
  createdAt: number;
  updatedAt: number;
}

export interface FileSearchParams {
  query?: string;
  source?: FileSource | string;
  storeZone?: StoreZone | string;
  startDate?: string;
  endDate?: string;
  cursor?: string;
  limit?: number;
}

export interface FileSearchResult {
  items: FileRegistryRecord[];
  nextCursor?: string;
  total: number;
}

export interface FileStats {
  totalFiles: number;
  totalSize: number;
  todayInbound: number;
  dedupSaved: number;
  dedupSize: number;
}