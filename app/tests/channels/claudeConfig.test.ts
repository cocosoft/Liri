/**
 * Claude 通道基础契约（2026-10-31，支持等级台账：community → core）
 *
 * 注意：`model` 留空是**合法**的（空 = 由模型体系提供默认模型，不硬编码模型名）。
 */
import {
  getDefaultClaudeConfig,
  validateClaudeConfig,
} from '../../src/channels/claude/config-schema';
import {
  getClaudeAccount,
  listClaudeAccountIds,
  registerClaudeAccount,
  removeClaudeAccount,
} from '../../src/channels/claude/accounts';
import { describeChannelBasics } from './support/channelBasics';

describeChannelBasics({
  id: 'claude',
  requiredKeys: ['apiKey'],
  defaults: () => getDefaultClaudeConfig(),
  validate: validateClaudeConfig,
  validConfig: { apiKey: 'sk-test', model: '', maxTokens: 4096 },
  accounts: {
    register: (id) =>
      registerClaudeAccount(id, {
        apiKey: 'sk-test',
        model: '',
        maxTokens: 4096,
      }),
    get: (id) => getClaudeAccount(id),
    list: () => listClaudeAccountIds(),
    remove: (id) => removeClaudeAccount(id),
  },
});
