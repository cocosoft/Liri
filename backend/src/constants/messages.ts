/**
 * 消息模板常量
 * 基于CC源码 cc_code/backend/constants/messages.ts 实现
 */

export const NO_CONTENT_MESSAGE = '(no content)';

export const DEFAULT_USER_MESSAGE_PLACEHOLDER = 'Type a message...';

export const DEFAULT_SYSTEM_MESSAGE_PREFIX = 'You are a helpful assistant.';

export const COMMAND_NOT_FOUND_MESSAGE = 'Command not found';
export const COMMAND_EXECUTION_ERROR_MESSAGE = 'Command execution error';
export const PERMISSION_DENIED_MESSAGE = 'Permission denied';
export const AUTHENTICATION_REQUIRED_MESSAGE = 'Authentication required';
export const NETWORK_ERROR_MESSAGE = 'Network error occurred';
export const TIMEOUT_ERROR_MESSAGE = 'Request timeout';
export const UNKNOWN_ERROR_MESSAGE = 'An unknown error occurred';

export const SESSION_EXPIRED_MESSAGE = 'Session has expired';
export const SESSION_NOT_FOUND_MESSAGE = 'Session not found';
export const INVALID_SESSION_MESSAGE = 'Invalid session';

export const TOOL_NOT_FOUND_MESSAGE = 'Tool not found';
export const TOOL_EXECUTION_ERROR_MESSAGE = 'Tool execution error';
export const TOOL_TIMEOUT_MESSAGE = 'Tool execution timeout';

export const CONFIG_NOT_FOUND_MESSAGE = 'Configuration not found';
export const CONFIG_INVALID_MESSAGE = 'Invalid configuration';
export const CONFIG_RELOAD_SUCCESS_MESSAGE =
  'Configuration reloaded successfully';

export const LOGIN_SUCCESS_MESSAGE = 'Login successful';
export const LOGIN_FAILED_MESSAGE = 'Login failed';
export const LOGOUT_SUCCESS_MESSAGE = 'Logout successful';

export const COMPACT_START_MESSAGE = 'Compacting conversation...';
export const COMPACT_COMPLETE_MESSAGE = 'Conversation compacted';
export const COMPACT_FAILED_MESSAGE = 'Failed to compact conversation';

export const MEMORY_SCAN_START_MESSAGE = 'Scanning memories...';
export const MEMORY_SCAN_COMPLETE_MESSAGE = 'Memory scan complete';
export const MEMORY_CREATED_MESSAGE = 'Memory created';
export const MEMORY_UPDATED_MESSAGE = 'Memory updated';
export const MEMORY_DELETED_MESSAGE = 'Memory deleted';

export const LSP_SERVER_STARTING_MESSAGE = 'Starting LSP server...';
export const LSP_SERVER_READY_MESSAGE = 'LSP server ready';
export const LSP_SERVER_ERROR_MESSAGE = 'LSP server error';
export const LSP_SERVER_STOPPED_MESSAGE = 'LSP server stopped';

export const MCP_SERVER_CONNECTING_MESSAGE = 'Connecting to MCP server...';
export const MCP_SERVER_CONNECTED_MESSAGE = 'MCP server connected';
export const MCP_SERVER_ERROR_MESSAGE = 'MCP server connection error';
export const MCP_SERVER_DISCONNECTED_MESSAGE = 'MCP server disconnected';

export const BRIDGE_CONNECTING_MESSAGE = 'Connecting to bridge...';
export const BRIDGE_CONNECTED_MESSAGE = 'Bridge connected';
export const BRIDGE_ERROR_MESSAGE = 'Bridge connection error';
export const BRIDGE_DISCONNECTED_MESSAGE = 'Bridge disconnected';

export const RETRY_MESSAGE = 'Retrying...';
export const CANCEL_MESSAGE = 'Cancelled';
export const SUCCESS_MESSAGE = 'Success';
export const FAILURE_MESSAGE = 'Failure';
export const WARNING_MESSAGE = 'Warning';
export const INFO_MESSAGE = 'Info';
