/**
 * API 错误消息管理
 *
 * 集中管理所有 API 错误场景的用户友好消息，
 * 支持多语言扩展和消息模板。
 */

import { APIScene } from '../api/APISceneClassifier';

/**
 * API 错误消息映射
 *
 * 每个场景对应：
 * - userMessage: 面向用户的友好消息
 * - actionHint: 建议的操作提示
 * - retryHint: 重试相关提示
 */
export interface APIErrorMessage {
  userMessage: string;
  actionHint?: string;
  retryHint?: string;
}

/**
 * API 错误消息注册表
 */
export const API_ERROR_MESSAGES: Record<APIScene, APIErrorMessage> = {
  [APIScene.RATE_LIMIT]: {
    userMessage: '请求频率过高，请稍后重试',
    actionHint: '降低请求频率或联系管理员提升配额',
    retryHint: '系统将根据 Retry-After 头自动重试',
  },
  [APIScene.SERVER_OVERLOAD]: {
    userMessage: '服务器繁忙，请稍后重试',
    actionHint: '服务器暂时过载，建议稍后重试',
    retryHint: '系统将在后台自动重试',
  },
  [APIScene.PROMPT_TOO_LONG]: {
    userMessage: '提示词过长，请缩短后重试',
    actionHint: '请减少输入内容或分段处理',
  },
  [APIScene.MEDIA_TOO_LARGE]: {
    userMessage: '媒体文件过大，请压缩后重试',
    actionHint: '建议压缩图片或视频后重新上传',
  },
  [APIScene.PDF_TOO_LARGE]: {
    userMessage: 'PDF 文件过大，请压缩后重试',
    actionHint: '建议压缩 PDF 后重新上传',
  },
  [APIScene.PDF_PASSWORD_PROTECTED]: {
    userMessage: 'PDF 文件受密码保护，请移除密码后重试',
    actionHint: '请提供未加密的 PDF 文件',
  },
  [APIScene.PDF_INVALID]: {
    userMessage: 'PDF 文件无效，请检查文件格式',
    actionHint: '请提供有效的 PDF 文件',
  },
  [APIScene.AUTH_FAILED]: {
    userMessage: '认证失败，请检查凭据',
    actionHint: '请检查 API Key 或 Token 是否有效',
  },
  [APIScene.TOKEN_EXPIRED]: {
    userMessage: 'Token 已过期，请重新登录',
    actionHint: '请刷新 Token 或重新登录',
  },
  [APIScene.TOKEN_REVOKED]: {
    userMessage: 'Token 已被撤销，请重新登录',
    actionHint: '请重新获取 Token',
  },
  [APIScene.OAUTH_ORG_NOT_ALLOWED]: {
    userMessage: 'OAuth 组织不允许访问',
    actionHint: '请联系管理员确认组织权限',
  },
  [APIScene.CONNECTION_ERROR]: {
    userMessage: '网络连接失败，请检查网络设置',
    actionHint: '请检查网络连接和代理设置',
    retryHint: '系统将自动重试连接',
  },
  [APIScene.CONNECTION_TIMEOUT]: {
    userMessage: '请求超时，请检查网络连接',
    actionHint: '请检查网络连接和代理设置',
    retryHint: '系统将自动重试连接',
  },
  [APIScene.SSL_CERT_ERROR]: {
    userMessage: 'SSL 证书错误，请检查安全配置',
    actionHint: '请检查 SSL 证书或代理设置',
  },
  [APIScene.MODEL_UNAVAILABLE]: {
    userMessage: '模型暂时不可用，请稍后重试',
    actionHint: '模型可能正在维护或过载',
    retryHint: '系统将自动重试',
  },
  [APIScene.MODEL_NOT_FOUND]: {
    userMessage: '模型不存在',
    actionHint: '请检查模型名称是否正确',
  },
  [APIScene.INVALID_MODEL]: {
    userMessage: '无效的模型名称',
    actionHint: '请检查模型名称是否正确',
  },
  [APIScene.CREDIT_LOW]: {
    userMessage: '信用余额不足，请充值后重试',
    actionHint: '请前往账户页面充值',
  },
  [APIScene.ORG_DISABLED]: {
    userMessage: '组织已被禁用',
    actionHint: '请联系管理员',
  },
  [APIScene.TOOL_USE_ERROR]: {
    userMessage: '工具调用失败，请检查参数',
    actionHint: '请检查工具参数是否正确',
  },
  [APIScene.TOOL_USE_MISMATCH]: {
    userMessage: '工具使用不匹配',
    actionHint: '请检查工具调用参数是否符合要求',
  },
  [APIScene.UNEXPECTED_TOOL_RESULT]: {
    userMessage: '意外的工具结果',
    actionHint: '请检查工具返回格式',
  },
  [APIScene.DUPLICATE_TOOL_USE_ID]: {
    userMessage: '工具使用 ID 重复',
    actionHint: '请使用唯一的工具使用 ID',
  },
  [APIScene.EXTRA_USAGE_REQUIRED]: {
    userMessage: '需要额外的使用信息',
    actionHint: '请提供更多使用详情',
  },
  [APIScene.CONTEXT_OVERFLOW]: {
    userMessage: '上下文溢出，请缩短对话',
    actionHint: '请减少对话长度或开始新对话',
  },
  [APIScene.FAST_MODE_NOT_ENABLED]: {
    userMessage: '快速模式未启用',
    actionHint: '请启用快速模式或降低请求频率',
  },
  [APIScene.REQUEST_TOO_LARGE]: {
    userMessage: '请求过大',
    actionHint: '请减少请求内容大小',
  },
  [APIScene.CAPACITY_OFF_SWITCH]: {
    userMessage: '容量开关已关闭',
    actionHint: '系统暂时不可用，请稍后重试',
  },
  [APIScene.REPEATED_529]: {
    userMessage: '服务器持续过载',
    actionHint: '请稍后重试',
    retryHint: '系统将保守重试',
  },
  [APIScene.BEDROCK_MODEL_ACCESS]: {
    userMessage: 'Bedrock 模型访问权限不足',
    actionHint: '请申请 Bedrock 模型访问权限',
  },
  [APIScene.ABORTED]: {
    userMessage: '请求已中止',
  },
  [APIScene.SERVER_ERROR]: {
    userMessage: '服务器错误，请稍后重试',
    actionHint: '服务器内部错误，请稍后重试',
    retryHint: '系统将自动重试',
  },
  [APIScene.CLIENT_ERROR]: {
    userMessage: '客户端错误，请检查请求',
    actionHint: '请检查请求参数是否正确',
  },
  [APIScene.UNKNOWN]: {
    userMessage: '发生未知错误',
    actionHint: '请稍后重试或联系技术支持',
  },
};

/**
 * 获取 API 错误的用户友好消息
 *
 * @param scene API 错误场景
 * @returns 错误消息对象
 */
export function getAPIErrorMessage(scene: APIScene): APIErrorMessage {
  return API_ERROR_MESSAGES[scene] ?? API_ERROR_MESSAGES[APIScene.UNKNOWN];
}

/**
 * 获取 API 错误的用户消息文本
 *
 * @param scene API 错误场景
 * @returns 用户消息文本
 */
export function getAPIUserMessage(scene: APIScene): string {
  return getAPIErrorMessage(scene).userMessage;
}

/**
 * 获取 API 错误的操作提示
 *
 * @param scene API 错误场景
 * @returns 操作提示文本，如果没有则返回空字符串
 */
export function getAPIActionHint(scene: APIScene): string {
  return getAPIErrorMessage(scene).actionHint ?? '';
}

/**
 * 获取 API 错误的重试提示
 *
 * @param scene API 错误场景
 * @returns 重试提示文本，如果没有则返回空字符串
 */
export function getAPIRetryHint(scene: APIScene): string {
  return getAPIErrorMessage(scene).retryHint ?? '';
}

/**
 * 自定义 API 错误消息
 *
 * 允许在运行时覆盖默认消息，支持多语言或品牌定制。
 *
 * @param scene API 错误场景
 * @param message 自定义消息
 */
export function customizeAPIErrorMessage(
  scene: APIScene,
  message: Partial<APIErrorMessage>
): void {
  const existing = API_ERROR_MESSAGES[scene];
  API_ERROR_MESSAGES[scene] = {
    ...existing,
    ...message,
  };
}

/**
 * 批量自定义 API 错误消息
 *
 * @param messages 消息映射
 */
export function customizeAPIErrorMessages(
  messages: Partial<Record<APIScene, Partial<APIErrorMessage>>>
): void {
  for (const [scene, message] of Object.entries(messages)) {
    customizeAPIErrorMessage(scene as APIScene, message);
  }
}
