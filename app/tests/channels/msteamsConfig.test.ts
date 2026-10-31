/**
 * Microsoft Teams 通道基础契约（2026-10-31，支持等级台账：community → core）
 */
import {
  getDefaultMSTeamsConfig,
  validateMSTeamsConfig,
} from '../../src/channels/msteams/config-schema';
import {
  getMSTeamsAccount,
  listMSTeamsAccountIds,
  registerMSTeamsAccount,
  removeMSTeamsAccount,
} from '../../src/channels/msteams/accounts';
import { describeChannelBasics } from './support/channelBasics';

describeChannelBasics({
  id: 'msteams',
  requiredKeys: ['tenantId', 'appId', 'appPassword'],
  defaults: () => getDefaultMSTeamsConfig(),
  validate: validateMSTeamsConfig,
  validConfig: {
    tenantId: 'tenant-1',
    appId: 'app-1',
    appPassword: 'pwd',
  },
  accounts: {
    register: (id) =>
      registerMSTeamsAccount(id, {
        tenantId: 'tenant-1',
        clientId: 'client-1',
        clientSecret: 'secret',
      }),
    get: (id) => getMSTeamsAccount(id),
    list: () => listMSTeamsAccountIds(),
    remove: (id) => removeMSTeamsAccount(id),
  },
});
