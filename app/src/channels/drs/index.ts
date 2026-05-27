/**
 * channels/drs/index.ts - DRS 动态注册服务模块导出
 */

export {
  DynamicRegistrationService,
  drs,
} from './DynamicRegistrationService.js';
export type {
  RegistrationSource,
  ChannelRegistration,
  ChannelCandidate,
  DnsEvents,
} from './DynamicRegistrationService.js';
