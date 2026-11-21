// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * MediaErrorCodes — Media 工具统一错误码
 */
export enum MediaErrorCode {
  FILE_NOT_FOUND = 'MEDIA_FILE_NOT_FOUND',
  FORMAT_UNSUPPORTED = 'MEDIA_FORMAT_UNSUPPORTED',
  FILE_CORRUPTED = 'MEDIA_FILE_CORRUPTED',
  PATH_INSECURE = 'MEDIA_PATH_INSECURE',
  PROCESS_FAILED = 'MEDIA_PROCESS_FAILED',
  FFMPEG_UNAVAILABLE = 'MEDIA_FFMPEG_UNAVAILABLE',
}

/** 错误码对应的中文消息 */
export const MEDIA_ERROR_MESSAGES: Record<MediaErrorCode, string> = {
  [MediaErrorCode.FILE_NOT_FOUND]: '文件不存在',
  [MediaErrorCode.FORMAT_UNSUPPORTED]: '不支持的格式',
  [MediaErrorCode.FILE_CORRUPTED]: '文件已损坏',
  [MediaErrorCode.PATH_INSECURE]: '路径越权，拒绝访问',
  [MediaErrorCode.PROCESS_FAILED]: '处理失败',
  [MediaErrorCode.FFMPEG_UNAVAILABLE]: 'FFmpeg 不可用',
};
