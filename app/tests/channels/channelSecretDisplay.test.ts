/**
 * BUG-01（2026-10-22 前端巡检）：渠道凭据回显必须**逐条容错**
 *
 * 事故：`channel_configs` 里 3 行密文与当前 `secret.key` 不匹配（密钥曾重建），
 * `decryptOptions()` 抛错 ⇒ `GET /v1/channels` 整表 500（渠道页统计全 0、
 * 仪表盘消息渠道指标失真）。
 *
 * 本用例锁四条语义：
 *  ① 回显路径（`getForDisplay` / `getAllSanitized`）坏字段只丢自己，不抛错；
 *  ② 坏字段名被回报（供前端提示"请重填"）；
 *  ③ 可读字段仍正常解密（不能因为一条坏字段把整条渠道作废）；
 *  ④ `get()`（建立连接用）仍 fail-closed —— 绝不把坏凭据当空串去发请求。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { setUserDataDirOverride } from '../../src/core/paths';
import {
  ChannelSecretStore,
  initRegistry,
} from '../../src/channels/secrets/ChannelSecretStore';
import { encryptSecret } from '../../src/channels/secrets/encryption';

/** 伪造 registry：只需要 getConfig / getAllConfigs（见 ChannelSecretStore 的最小接口） */
function fakeRegistry(
  configs: Record<string, { type: string; options?: Record<string, unknown> }>
) {
  return {
    getConfig: (name: string) =>
      configs[name]
        ? { options: configs[name].options, type: configs[name].type }
        : undefined,
    updateConfig: () => true,
    getAllConfigs: () => Object.values(configs),
  };
}

/** 合法密文格式、但用另一把密钥加密 ⇒ 必然解密失败（模拟密钥漂移） */
const CORRUPT = 'enc:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBB:CCCCCCCC';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-channel-display-'));
  setUserDataDirOverride(root);
});

afterEach(() => {
  // 归还一个空 registry，避免影响同进程内其它用例
  initRegistry(fakeRegistry({}));
  setUserDataDirOverride(null);
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // @ignore-catch — Windows 句柄延迟释放时清理失败不影响断言
  }
});

describe('ChannelSecretStore：凭据回显容错', () => {
  it('坏密文字段被跳过并回报，可读字段照常解密', () => {
    initRegistry(
      fakeRegistry({
        qq: {
          type: 'qq',
          options: { appId: encryptSecret('app-1'), clientSecret: CORRUPT },
        },
      })
    );

    const { credentials, unreadableFields } =
      ChannelSecretStore.getInstance().getForDisplay('qq');

    expect(credentials.appId).toBe('app-1');
    expect(credentials.clientSecret).toBeUndefined();
    expect(unreadableFields).toEqual(['clientSecret']);
  });

  it('getAllSanitized 不再因单条坏密文整批抛错', () => {
    initRegistry(
      fakeRegistry({
        qq: {
          type: 'qq',
          options: { appId: encryptSecret('app-1'), clientSecret: CORRUPT },
        },
        feishu: { type: 'feishu', options: { appId: encryptSecret('cli_x') } },
      })
    );

    expect(() =>
      ChannelSecretStore.getInstance().getAllSanitized()
    ).not.toThrow();
    const all = ChannelSecretStore.getInstance().getAllSanitized();
    expect(all.qq?.appId).toBe('ap****-1');
    expect(all.feishu?.appId).toBe('cl****_x');
  });

  it('get() 仍 fail-closed（连接路径不得静默使用坏凭据）', () => {
    initRegistry(
      fakeRegistry({
        qq: { type: 'qq', options: { clientSecret: CORRUPT } },
      })
    );

    expect(() => ChannelSecretStore.getInstance().get('qq')).toThrow(
      '渠道凭据解密失败'
    );
  });

  it('全部字段都不可读 ⇒ 凭据为空 + 全部字段名回报（前端据此要求重填）', () => {
    initRegistry(
      fakeRegistry({
        dingtalk: { type: 'dingtalk', options: { appKey: CORRUPT } },
      })
    );

    const { credentials, unreadableFields } =
      ChannelSecretStore.getInstance().getForDisplay('dingtalk');

    expect(credentials).toEqual({});
    expect(unreadableFields).toEqual(['appKey']);
  });

  it('未配置（无 options）⇒ 空凭据且不报不可读（避免误显示"请重填"）', () => {
    initRegistry(fakeRegistry({ telegram: { type: 'telegram' } }));

    const { credentials, unreadableFields } =
      ChannelSecretStore.getInstance().getForDisplay('telegram');

    expect(unreadableFields).toEqual([]);
    // 本地身份允许 env 回退 ⇒ 只断言"没有把未配置误判为损坏"
    expect(typeof credentials).toBe('object');
  });
});
