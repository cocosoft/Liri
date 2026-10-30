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
    // #22：空白名回落「项目 YYYY-MM-DD HH:mm」（不再是无从区分的「未命名项目」）
    expect(
      resolveProjectIdentity('   ', { now: new Date(2026, 9, 30, 14, 5) }).name
    ).toBe('项目 2026-10-30 14:05');
    expect(resolveProjectIdentity('x'.repeat(80)).name.endsWith('…')).toBe(
      true
    );
  });
});

/**
 * #22（2026-10-30）：项目名"未闭合括号 / 引用块被当标题"的回归锁。
 *
 * 真机遗留值（`project.json` 已存，前端原样显示）：
 * - `【E:\PY\Documents\CODES\PY_APP\`（截断在 `【…】` 中间）
 * - `我与gemini进行了一轮沟通，见【E:\PY\Docume`（引用块里的路径被截进名称）
 */
describe('create_project 名称清洗（#22）', () => {
  const now = new Date(2026, 9, 30, 14, 5);

  it('未闭合引用块 ⇒ 丢掉块内残余，不留悬空 `【` / `\\`', () => {
    const r = resolveProjectIdentity(
      '我与gemini进行了一轮沟通，见【E:\\PY\\Docume',
      {
        now,
      }
    );
    expect(r.name).toBe('我与gemini进行了一轮沟通，见');
    expect(r.name.includes('【')).toBe(false);
    expect(r.name.includes('\\')).toBe(false);
  });

  it('标题里夹带的完整引用块被摘掉（路径不进名称）', () => {
    expect(
      resolveProjectIdentity('分析日志【E:\\PY\\app\\debug.log】的问题', {
        now,
      }).name
    ).toBe('分析日志 的问题');
  });

  it('整条就是一个引用块 ⇒ 取块内文本，不是丢掉', () => {
    expect(resolveProjectIdentity('【俄罗斯方块】', { now }).name).toBe(
      '俄罗斯方块'
    );
  });

  it('代码块 / 行内代码不进名称', () => {
    expect(
      resolveProjectIdentity('修复崩溃 ```ts\nthrow new Error()\n```', { now })
        .name
    ).toBe('修复崩溃');
    expect(resolveProjectIdentity('看 `E:\\a\\b` 的配置', { now }).name).toBe(
      '看 的配置'
    );
  });

  it('清洗后为空（只剩代码块）⇒ 回落「项目 YYYY-MM-DD HH:mm」', () => {
    expect(resolveProjectIdentity('```\ncode\n```', { now }).name).toBe(
      '项目 2026-10-30 14:05'
    );
    expect(resolveProjectIdentity('', { now }).name).toBe(
      '项目 2026-10-30 14:05'
    );
  });

  it('整条是路径 ⇒ 仍按 FIX-11 取目录名（路径优先级高于默认名）', () => {
    // `【E:\a\b】` 去外层括号后是路径 ⇒ 走 resolveProjectIdentity 的路径分支，用目录名
    expect(resolveProjectIdentity('【E:\\a\\b】', { now }).name).toBe('b');
  });

  it('截断按字符计且不切在括号内部（长标题）', () => {
    // 60 字处恰好落在未闭合的 `（…` 内 ⇒ 丢弃该括号起的内容再补 `…`
    const long = `${'甲'.repeat(30)}（${'乙'.repeat(60)}）`;
    const name = resolveProjectIdentity(long, { now }).name;
    expect(Array.from(name).length).toBeLessThanOrEqual(61);
    expect(name.endsWith('…')).toBe(true);
    expect(name.includes('（')).toBe(false);
  });

  it('截断不会切开 emoji 代理对（按码点计）', () => {
    const name = resolveProjectIdentity('😀'.repeat(70), { now }).name;
    expect(Array.from(name).length).toBe(61); // 60 码点 + `…`
    expect(name.endsWith('…')).toBe(true);
  });

  it('正常标题原样保留（清洗不误伤）', () => {
    expect(
      resolveProjectIdentity('重构 create_project 名称清洗（#22）', { now })
        .name
    ).toBe('重构 create_project 名称清洗（#22）');
  });
});
