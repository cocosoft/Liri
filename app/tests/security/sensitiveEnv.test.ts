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
 * A3（2026-10-09）— 敏感环境变量剥离单一事实源单元测试
 *
 * 覆盖 isSensitiveEnvKey / stripSensitiveEnv：密钥族（*_API_KEY / *SECRET* /
 * *TOKEN* / PASSWORD / AUTH / CREDENTIAL）与具名云/SSH 凭据被识剥离，
 * 普通变量保留，且不修改入参。
 */
import { describe, it, expect } from 'bun:test';
import {
  isSensitiveEnvKey,
  stripSensitiveEnv,
} from '../../src/security/sensitiveEnv.js';

describe('isSensitiveEnvKey（A3）', () => {
  it('识别密钥族（大小写不敏感）', () => {
    expect(isSensitiveEnvKey('FAKE_API_KEY')).toBe(true);
    expect(isSensitiveEnvKey('MY_SECRET')).toBe(true);
    expect(isSensitiveEnvKey('ACCESS_TOKEN')).toBe(true);
    expect(isSensitiveEnvKey('DB_PASSWORD')).toBe(true);
    expect(isSensitiveEnvKey('ssh_auth_sock')).toBe(true);
    expect(isSensitiveEnvKey('GOOGLE_APPLICATION_CREDENTIALS')).toBe(true);
    expect(isSensitiveEnvKey('AWS_SECRET_ACCESS_KEY')).toBe(true);
  });

  it('保留普通变量', () => {
    expect(isSensitiveEnvKey('PATH')).toBe(false);
    expect(isSensitiveEnvKey('HOME')).toBe(false);
    expect(isSensitiveEnvKey('NODE_ENV')).toBe(false);
  });
});

describe('stripSensitiveEnv（A3）', () => {
  it('剥离父进程注入的密钥，保留普通变量', () => {
    const out = stripSensitiveEnv({
      FAKE_API_KEY: 'secret',
      SSH_AUTH_SOCK: '/tmp/agent.sock',
      NORMAL_VAR: 'keep',
      PATH: '/usr/bin',
    });
    expect(out.FAKE_API_KEY).toBeUndefined();
    expect(out.SSH_AUTH_SOCK).toBeUndefined();
    expect(out.NORMAL_VAR).toBe('keep');
    expect(out.PATH).toBe('/usr/bin');
  });

  it('不修改入参', () => {
    const input = { FAKE_API_KEY: 'secret', KEEP: 'v' };
    stripSensitiveEnv(input);
    expect(input.FAKE_API_KEY).toBe('secret');
  });
});
