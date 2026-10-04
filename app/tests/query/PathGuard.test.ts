/**
 * PathGuard 单元守卫（2026-09-29 新增，spec `pathguard-registry-driven-args.md`）。
 *
 * 覆盖四条目标：
 *  - **G1**：**静态名单外**的工具（如 MCP 动态名 `mcp__<server>__<tool>`）经注入的注册表解析器
 *    ⇒ 其路径入参**被拒绝列表检查**（修复前为 fail-open：完全检查不到）；
 *  - **G2**：**非路径**键的值形似拒绝模式 ⇒ **必须放行**（否则会误拦 URL / 提示词 —— 这是
 *    "把注册表入参全当路径"会引入的误拦，故用 `PATH_ARG_KEYS` 求交收窄）；
 *  - **G3**：未注入解析器 / 注册表未命中 ⇒ 与历史行为**逐字段一致**；
 *  - 静态写名单仍生效（`denyWrite ⊃ denyRead`，lockfile 只拦写）。
 */
import { describe, expect, it } from 'bun:test';
import { createPathGuard } from '../../src/query/PathGuard';

/** 模拟"注册表派生解析器"：按工具名返回其声明的入参名；未声明 ⇒ null（未注册） */
const stubResolver =
  (params: Record<string, string[]>) =>
  (toolName: string): string[] | null =>
    params[toolName] ?? null;

describe('PathGuard：运行期注册表驱动路径入参（G1 / G2）', () => {
  it('G1 名单外工具（模拟 MCP）：声明 file_path ⇒ 命中拒绝列表时拦截', () => {
    const guard = createPathGuard({
      resolvePathArgKeys: stubResolver({
        mcp__fs__read_file: ['file_path'],
      }),
    });

    expect(
      guard.checkToolCall('mcp__fs__read_file', { file_path: '/repo/.env' })
        .allowed
    ).toBe(false);
    expect(
      guard.checkToolCall('mcp__fs__read_file', { file_path: '/repo/src/a.ts' })
        .allowed
    ).toBe(true);
  });

  it('G1 对照：未注入解析器时同一调用放行（证明本次是**净收紧**）', () => {
    const guard = createPathGuard();
    expect(
      guard.checkToolCall('mcp__fs__read_file', { file_path: '/repo/.env' })
        .allowed
    ).toBe(true);
  });

  it('G2 非路径键（url）不进判定 ⇒ 形似拒绝模式也放行', () => {
    const guard = createPathGuard({
      resolvePathArgKeys: stubResolver({ mcp__web__fetch: ['url'] }),
    });

    // `url` 不在 PATH_ARG_KEYS ⇒ 求交为空 ⇒ 不判定 ⇒ 放行
    expect(
      guard.checkToolCall('mcp__web__fetch', {
        url: 'https://example.com/.env',
      }).allowed
    ).toBe(true);
  });

  it('G2 混合键：只认路径语义键，其余键不进判定', () => {
    const guard = createPathGuard({
      resolvePathArgKeys: stubResolver({ mcp__fs__write: ['path', 'content'] }),
    });

    // `content` 形似但不在键集合内；被检查的只有 `path`
    expect(
      guard.checkToolCall('mcp__fs__write', {
        path: '/repo/src/a.ts',
        content: 'see /repo/.env',
      }).allowed
    ).toBe(true);
    expect(
      guard.checkToolCall('mcp__fs__write', {
        path: '/repo/.env',
        content: 'x',
      }).allowed
    ).toBe(false);
  });

  it('G3 注册表未命中（返回 null）⇒ 回退静态名单', () => {
    const guard = createPathGuard({ resolvePathArgKeys: () => null });

    expect(
      guard.checkToolCall('file_read', { file_path: '/repo/.env' }).allowed
    ).toBe(false);
    // 名单外工具在回退分支同样提不到路径 ⇒ 放行（与历史一致）
    expect(
      guard.checkToolCall('mcp__fs__read_file', { file_path: '/repo/.env' })
        .allowed
    ).toBe(true);
  });
});

describe('PathGuard：静态名单分支零回归', () => {
  it('未注入解析器：file_read 命中 .env ⇒ 拦截；普通路径 ⇒ 放行', () => {
    const guard = createPathGuard();
    expect(
      guard.checkToolCall('file_read', { file_path: '/a/.env' }).allowed
    ).toBe(false);
    expect(
      guard.checkToolCall('file_read', { file_path: '/a/b.ts' }).allowed
    ).toBe(true);
  });

  it('写名单：lockfile 只拦写、不拦读（denyWrite ⊃ denyRead）', () => {
    const guard = createPathGuard();
    expect(
      guard.checkToolCall('file_write', { file_path: '/a/bun.lockb' }).allowed
    ).toBe(false);
    expect(
      guard.checkToolCall('file_read', { file_path: '/a/bun.lockb' }).allowed
    ).toBe(true);
  });

  it('无路径参数的工具调用 ⇒ 放行（fail-open 语义不变）', () => {
    const guard = createPathGuard();
    expect(guard.checkToolCall('bash', { command: 'cat .env' }).allowed).toBe(
      true
    );
  });
});

describe('PathGuard：write_project_file 覆盖（P0-9，2026-10-04）', () => {
  it('静态名单：relativePath 命中 denyWrite（**/auth/**）⇒ 拦截；普通相对路径 ⇒ 放行', () => {
    const guard = createPathGuard();
    expect(
      guard.checkToolCall('write_project_file', {
        projectId: 'p1',
        relativePath: 'auth/credentials.json',
        content: 'x',
      }).allowed
    ).toBe(false);
    expect(
      guard.checkToolCall('write_project_file', {
        projectId: 'p1',
        relativePath: 'output/report.md',
        content: 'x',
      }).allowed
    ).toBe(true);
  });

  it('写类判别：只拦写、不因是"写工具"而拦读（lockfile 场景）', () => {
    const guard = createPathGuard();
    // 写类工具 + 普通路径 ⇒ 放行（未被误拦）
    expect(
      guard.checkToolCall('write_project_file', {
        projectId: 'p1',
        relativePath: 'src/a.ts',
      }).allowed
    ).toBe(true);
  });

  it('注册表分支：声明 relativePath ⇒ 与 PATH_ARG_KEYS 求交命中（此前为空 ⇒ fail-open）', () => {
    const guard = createPathGuard({
      resolvePathArgKeys: stubResolver({
        write_project_file: ['projectId', 'relativePath', 'content'],
      }),
    });
    expect(
      guard.checkToolCall('write_project_file', {
        projectId: 'p1',
        relativePath: 'auth/token.pem',
        content: 'x',
      }).allowed
    ).toBe(false);
  });
});
