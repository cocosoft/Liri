/**
 * 插件注册系统导出
 */

export {
  CommandRegistration,
  commandRegistration,
} from './CommandRegistration.js';
export type {
  PluginCommand,
  CommandResult,
  CommandRegistrationEntry,
} from './CommandRegistration.js';

export {
  InteractionRegistry,
  interactionRegistry,
} from './InteractionRegistry.js';
export type {
  InteractionType,
  InteractionHandler,
  InteractionResponse,
  InteractionEntry,
} from './InteractionRegistry.js';

export { HttpRegistry, httpRegistry } from './HttpRegistry.js';
export type {
  HttpMethod,
  HttpRequestContext,
  HttpResponse,
  HttpRouteHandler,
  HttpRouteEntry,
} from './HttpRegistry.js';
