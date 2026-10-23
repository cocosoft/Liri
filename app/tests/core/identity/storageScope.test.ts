/**
 * 身份化存储作用域（多租户 P1）
 *
 * 锁四件事：
 *  ① 本地身份 ⇒ 原数据根（桌面路径零变更）；
 *  ② 已认证身份 ⇒ `<base>/tenants/<tenant>/users/<user>`；
 *  ③ 路径段注入防护：`..`、分隔符、空串、超长 ⇒ 确定性哈希（绝不逃逸出 tenants/）；
 *  ④ 同一标识多次计算稳定（幂等）。
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'path';

import {
  LOCAL_PRINCIPAL,
  type Principal,
} from '@modules/core/identity/principal';
import {
  isPartitionedScope,
  safePathSegment,
  scopedDataRoot,
} from '@modules/core/identity/storageScope';

const BASE = join('/tmp', 'liri-data');
const ALICE: Principal = {
  tenantId: 'acme',
  userId: 'alice',
  roles: ['user'],
};

describe('storageScope：数据根', () => {
  it('本地身份 ⇒ 原数据根（不新增任何分段）', () => {
    expect(scopedDataRoot(BASE, LOCAL_PRINCIPAL)).toBe(BASE);
    expect(isPartitionedScope(LOCAL_PRINCIPAL)).toBe(false);
  });

  it('已认证身份 ⇒ tenants/<tenant>/users/<user>', () => {
    expect(scopedDataRoot(BASE, ALICE)).toBe(
      join(BASE, 'tenants', 'acme', 'users', 'alice')
    );
    expect(isPartitionedScope(ALICE)).toBe(true);
  });

  it('同一身份多次计算稳定', () => {
    expect(scopedDataRoot(BASE, ALICE)).toBe(scopedDataRoot(BASE, ALICE));
  });
});

describe('storageScope：路径段注入防护', () => {
  it('普通标识原样保留（目录可读）', () => {
    expect(safePathSegment('alice')).toBe('alice');
    expect(safePathSegment('acme-corp_1.0')).toBe('acme-corp_1.0');
  });

  it('试图穿越的标识 ⇒ 确定性哈希，且不含分隔符', () => {
    for (const evil of ['..', '../..', '../../etc', 'a/b', 'a\\b', '']) {
      const seg = safePathSegment(evil);
      expect(seg.startsWith('h_')).toBe(true);
      expect(seg).not.toContain('/');
      expect(seg).not.toContain('\\');
      expect(seg).not.toBe('.');
      expect(seg).not.toBe('..');
      // 幂等
      expect(safePathSegment(evil)).toBe(seg);
    }
  });

  it('超长标识 ⇒ 哈希（不会产生超长目录名）', () => {
    const seg = safePathSegment('x'.repeat(200));
    expect(seg.startsWith('h_')).toBe(true);
    expect(seg.length).toBeLessThanOrEqual(64);
  });

  it('穿越型标识不会逃出 tenants/ 前缀', () => {
    const evil: Principal = {
      tenantId: '../../etc',
      userId: '..',
      roles: ['user'],
    };
    const root = scopedDataRoot(BASE, evil);
    expect(root.startsWith(join(BASE, 'tenants'))).toBe(true);
    expect(root).not.toContain('..');
  });
});
