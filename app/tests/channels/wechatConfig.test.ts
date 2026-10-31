/**
 * WeChat 通道基础契约（2026-10-31，支持等级台账：community → core）
 *
 * 已知遗留：`WechatChannel.ts` 的 `parseWechatXML` / `WechatCrypto` 是空实现（本地台账 FIX-12），
 * 故本测试只覆盖配置与账户注册表，不覆盖验签/解析。
 */
import {
  getDefaultWechatConfig,
  validateWechatConfig,
} from '../../src/channels/wechat/config-schema';
import {
  getWechatAccount,
  listWechatAccountIds,
  registerWechatAccount,
  removeWechatAccount,
} from '../../src/channels/wechat/accounts';
import { describeChannelBasics } from './support/channelBasics';

describeChannelBasics({
  id: 'wechat',
  requiredKeys: ['botHttpUrl'],
  defaults: () => getDefaultWechatConfig(),
  validate: validateWechatConfig,
  validConfig: { botHttpUrl: 'http://127.0.0.1:3000' },
  accounts: {
    register: (id) =>
      registerWechatAccount(id, {
        appId: 'appid',
        appSecret: 'secret',
        token: 'token',
      }),
    get: (id) => getWechatAccount(id),
    list: () => listWechatAccountIds(),
    remove: (id) => removeWechatAccount(id),
  },
});
