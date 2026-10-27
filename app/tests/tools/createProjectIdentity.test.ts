/**
 * FIX-11（2026-10-27）：`create_project` 的名称/沙箱解析。
 *
 * 真机证据：项目 `proj_1792831085133_bfc455` 的 name/description 都是
 * `【E:\PY\Documents\CODES\PY_APP\`（把路径当名字，且 `【` 未闭合），
 * 沙箱却落在空目录 `~/Documents/LiriProjects/<id>` ⇒ always-on 会话读仓库被边界拒绝 6 次。
 */
import { describe, expect, it } from 'bun:test';

import { resolveProjectIdentity } from '../../src/tools/CreateProjectTool/projectName';

const yes = (): boolean => true;
const no = (): boolean => false;

describe('create_project 名称解析（FIX-11）', () => {
  it('名称是**已存在目录** ⇒ 目录作沙箱根，标题用目录名', () => {
    const r = resolveProjectIdentity('【E:\\PY\\Documents\\CODES\\PY_APP\\', {
      isDirectory: yes,
    });
    expect(r.name).toBe('PY_APP');
    expect(r.sandboxPath).toBe('E:\\PY\\Documents\\CODES\\PY_APP');
  });

  it('路径不存在 ⇒ 只净化标题，不指定沙箱（避免指向不存在目录）', () => {
    const r = resolveProjectIdentity('E:\\not\\exists\\proj', {
      isDirectory: no,
    });
    expect(r.name).toBe('proj');
    expect(r.sandboxPath).toBeUndefined();
  });

  it('POSIX 路径同样可解析（跨平台基名）', () => {
    const r = resolveProjectIdentity('/home/me/work/demo', {
      isDirectory: yes,
    });
    expect(r.name).toBe('demo');
    expect(r.sandboxPath).toBe('/home/me/work/demo');
  });

  it('普通标题原样保留；外层括号被去掉', () => {
    expect(resolveProjectIdentity('俄罗斯方块小游戏').name).toBe(
      '俄罗斯方块小游戏'
    );
    expect(resolveProjectIdentity('【俄罗斯方块】').name).toBe('俄罗斯方块');
  });

  it('标题里只是**提到**路径（非整体）⇒ 不触发目录特判', () => {
    const r = resolveProjectIdentity('分析 E:\\PY\\APP 的日志', {
      isDirectory: yes,
    });
    expect(r.sandboxPath).toBeUndefined();
    expect(r.name).toBe('分析 E:\\PY\\APP 的日志');
  });

  it('空白 / 超长名称被净化', () => {
    expect(resolveProjectIdentity('   ').name).toBe('未命名项目');
    expect(resolveProjectIdentity('x'.repeat(80)).name.endsWith('…')).toBe(
      true
    );
  });
});
