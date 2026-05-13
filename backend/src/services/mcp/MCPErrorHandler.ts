//
/**
 * MCP错误处理
 * 负责定义和处理MCP系统的错误
 */

import { logger } from '@modules/utils/log';

/**
 * MCP错误类型
 */
export enum MCPErrorType {
  // 连接错误
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  RECONNECTION_FAILED = 'RECONNECTION_FAILED',
  SERVER_DISCONNECTED = 'SERVER_DISCONNECTED',

  // 认证错误
  AUTHENTICATION_REQUIRED = 'AUTHENTICATION_REQUIRED',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',

  // 工具错误
  TOOL_FETCH_FAILED = 'TOOL_FETCH_FAILED',
  TOOL_EXECUTION_FAILED = 'TOOL_EXECUTION_FAILED',

  // 命令错误
  COMMAND_FETCH_FAILED = 'COMMAND_FETCH_FAILED',
  COMMAND_EXECUTION_FAILED = 'COMMAND_EXECUTION_FAILED',

  // 资源错误
  RESOURCE_FETCH_FAILED = 'RESOURCE_FETCH_FAILED',

  // 配置错误
  INVALID_CONFIG = 'INVALID_CONFIG',
  CONFIG_NOT_FOUND = 'CONFIG_NOT_FOUND',

  // 其他错误
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * MCP错误类
 */
export class MCPError extends Error {
  public type: MCPErrorType;
  public serverName?: string;
  public details?: unknown;

  constructor(
    message: string,
    type: MCPErrorType = MCPErrorType.UNKNOWN_ERROR,
    serverName?: string,
    details?: unknown
  ) {
    super(message);
    this.name = 'MCPError';
    this.type = type;
    this.serverName = serverName;
    this.details = details;
  }
}

/**
 * MCP错误工厂
 */
export class MCPErrorFactory {
  /**
   * 创建连接错误
   */
  static createConnectionError(
    message: string,
    serverName?: string,
    details?: unknown
  ): MCPError {
    return new MCPError(
      message,
      MCPErrorType.CONNECTION_FAILED,
      serverName,
      details
    );
  }

  /**
   * 创建重连错误
   */
  static createReconnectionError(
    message: string,
    serverName?: string,
    details?: unknown
  ): MCPError {
    return new MCPError(
      message,
      MCPErrorType.RECONNECTION_FAILED,
      serverName,
      details
    );
  }

  /**
   * 创建认证错误
   */
  static createAuthError(
    message: string,
    serverName?: string,
    details?: unknown
  ): MCPError {
    return new MCPError(
      message,
      MCPErrorType.AUTHENTICATION_REQUIRED,
      serverName,
      details
    );
  }

  /**
   * 创建工具错误
   */
  static createToolError(
    message: string,
    serverName?: string,
    details?: unknown
  ): MCPError {
    return new MCPError(
      message,
      MCPErrorType.TOOL_FETCH_FAILED,
      serverName,
      details
    );
  }

  /**
   * 创建命令错误
   */
  static createCommandError(
    message: string,
    serverName?: string,
    details?: unknown
  ): MCPError {
    return new MCPError(
      message,
      MCPErrorType.COMMAND_FETCH_FAILED,
      serverName,
      details
    );
  }

  /**
   * 创建资源错误
   */
  static createResourceError(
    message: string,
    serverName?: string,
    details?: unknown
  ): MCPError {
    return new MCPError(
      message,
      MCPErrorType.RESOURCE_FETCH_FAILED,
      serverName,
      details
    );
  }

  /**
   * 创建配置错误
   */
  static createConfigError(
    message: string,
    serverName?: string,
    details?: unknown
  ): MCPError {
    return new MCPError(
      message,
      MCPErrorType.INVALID_CONFIG,
      serverName,
      details
    );
  }

  /**
   * 创建未知错误
   */
  static createUnknownError(
    message: string,
    serverName?: string,
    details?: unknown
  ): MCPError {
    return new MCPError(
      message,
      MCPErrorType.UNKNOWN_ERROR,
      serverName,
      details
    );
  }
}

/**
 * MCP错误处理器
 */
export class MCPErrorHandler {
  /**
   * 处理MCP错误
   */
  static handleError(error: unknown, serverName?: string): void {
    if (error instanceof MCPError) {
      this.handleMCPError(error);
    } else if (error instanceof Error) {
      this.handleGenericError(error, serverName);
    } else {
      this.handleUnknownError(error, serverName);
    }
  }

  /**
   * 处理MCP错误
   */
  private static handleMCPError(error: MCPError): void {
    const serverContext = error.serverName
      ? ` [Server: ${error.serverName}]`
      : '';

    switch (error.type) {
      case MCPErrorType.CONNECTION_FAILED:
        logger.error(`MCP Connection Failed${serverContext}: ${error.message}`);
        break;
      case MCPErrorType.RECONNECTION_FAILED:
        logger.error(
          `MCP Reconnection Failed${serverContext}: ${error.message}`
        );
        break;
      case MCPErrorType.SERVER_DISCONNECTED:
        logger.warn(
          `MCP Server Disconnected${serverContext}: ${error.message}`
        );
        break;
      case MCPErrorType.AUTHENTICATION_REQUIRED:
        logger.warn(
          `MCP Authentication Required${serverContext}: ${error.message}`
        );
        break;
      case MCPErrorType.AUTHENTICATION_FAILED:
        logger.error(
          `MCP Authentication Failed${serverContext}: ${error.message}`
        );
        break;
      case MCPErrorType.TOOL_FETCH_FAILED:
        logger.error(`MCP Tool Fetch Failed${serverContext}: ${error.message}`);
        break;
      case MCPErrorType.TOOL_EXECUTION_FAILED:
        logger.error(
          `MCP Tool Execution Failed${serverContext}: ${error.message}`
        );
        break;
      case MCPErrorType.COMMAND_FETCH_FAILED:
        logger.error(
          `MCP Command Fetch Failed${serverContext}: ${error.message}`
        );
        break;
      case MCPErrorType.COMMAND_EXECUTION_FAILED:
        logger.error(
          `MCP Command Execution Failed${serverContext}: ${error.message}`
        );
        break;
      case MCPErrorType.RESOURCE_FETCH_FAILED:
        logger.error(
          `MCP Resource Fetch Failed${serverContext}: ${error.message}`
        );
        break;
      case MCPErrorType.INVALID_CONFIG:
        logger.error(`MCP Invalid Config${serverContext}: ${error.message}`);
        break;
      case MCPErrorType.CONFIG_NOT_FOUND:
        logger.warn(`MCP Config Not Found${serverContext}: ${error.message}`);
        break;
      default:
        logger.error(`MCP Unknown Error${serverContext}: ${error.message}`);
    }

    if (error.details) {
      logger.debug('Error details:', error.details as Record<string, unknown>);
    }
  }

  /**
   * 处理通用错误
   */
  private static handleGenericError(error: Error, serverName?: string): void {
    const serverContext = serverName ? ` [Server: ${serverName}]` : '';
    logger.error(`MCP Generic Error${serverContext}: ${error.message}`);
    if (error.stack) {
      logger.debug('Error stack:', { stack: error.stack });
    }
  }

  /**
   * 处理未知错误
   */
  private static handleUnknownError(error: unknown, serverName?: string): void {
    const serverContext = serverName ? ` [Server: ${serverName}]` : '';
    logger.error(`MCP Unknown Error${serverContext}: ${String(error)}`);
  }

  /**
   * 记录错误
   */
  static logError(
    error: unknown,
    loggerInstance: {
      error: (message: string) => void;
      debug: (message: string) => void;
    }
  ): void {
    if (error instanceof MCPError) {
      this.handleMCPError(error);
    } else if (error instanceof Error) {
      loggerInstance.error(error.message);
      if (error.stack) {
        loggerInstance.debug(error.stack);
      }
    } else {
      loggerInstance.error(String(error));
    }
  }
}
