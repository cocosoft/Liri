// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * 错误系统类型定义
 */

/**
 * 错误类型
 */
export enum ErrorType {
  /**
   * 系统错误
   */
  SYSTEM = 'system',
  /**
   * 业务错误
   */
  BUSINESS = 'business',
  /**
   * 网络错误
   */
  NETWORK = 'network',
  /**
   * 认证错误
   */
  AUTHENTICATION = 'authentication',
  /**
   * 授权错误
   */
  AUTHORIZATION = 'authorization',
  /**
   * 输入错误
   */
  INPUT = 'input',
  /**
   * 资源错误
   */
  RESOURCE = 'resource',
  /**
   * 插件错误
   */
  PLUGIN = 'plugin',
  /**
   * 工具错误
   */
  TOOL = 'tool',
  /**
   * 其他错误
   */
  OTHER = 'other',
}

/**
 * 错误级别
 */
export enum ErrorLevel {
  /**
   * 调试
   */
  DEBUG = 'debug',
  /**
   * 信息
   */
  INFO = 'info',
  /**
   * 警告
   */
  WARNING = 'warning',
  /**
   * 错误
   */
  ERROR = 'error',
  /**
   * 致命
   */
  FATAL = 'fatal',
}

/**
 * 错误接口
 */
export interface AppError {
  /**
   * 错误ID
   */
  id: string;
  /**
   * 错误类型
   */
  type: ErrorType;
  /**
   * 错误级别
   */
  level: ErrorLevel;
  /**
   * 错误消息
   */
  message: string;
  /**
   * 错误代码
   */
  code?: string;
  /**
   * 错误详情
   */
  details?: unknown;
  /**
   * 原始错误
   */
  originalError?: Error;
  /**
   * 错误发生时间
   */
  timestamp: number;
  /**
   * 错误发生位置
   */
  location?: string;
  /**
   * 错误堆栈
   */
  stack?: string;
}

/**
 * 错误处理选项
 */
export interface ErrorHandlerOptions {
  /**
   * 是否记录错误
   */
  log?: boolean;
  /**
   * 是否返回详细错误信息
   */
  detailed?: boolean;
  /**
   * 错误处理回调
   */
  callback?: (error: AppError) => void;
}
