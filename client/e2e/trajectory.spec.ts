import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * 轨迹模块 E2E（P2-4，2026-09-23）
 *
 * **覆盖目标：单测跑不到的「装配层」缺陷。**
 * 典型先例：`TrajectoryDetail` 曾**只有具名导出**，而消费方 `ChatInspector` 用默认导入
 * ⇒ ESM 下拿到 `undefined`，选中记录时 React 抛 "Element type is invalid"
 * （2026-09-22 修复）。该缺陷在 vitest 里**全绿** —— 组件级测试直接 import 具名导出，
 * 永远走不到"默认导入"这条路径。只有跑真实路由 + 真实 store 装配的 e2e 才能拦住它。
 *
 * **策略（沿用 e2e/task-center.spec.ts 惯例）**
 * - **不触发真实 AI**（CI 离线无模型），故不发送聊天消息、不点"执行"；
 * - 进入轨迹 Tab 走真实 UI 路径（收起栏图标 → 展开并切 Tab），**不做数据准备**；
 * - 对"本地有真实会话 / CI 空库"两种环境一律做**双态断言**，不依赖数据库内容；
 * - 数据不足时用 `test.skip(条件, 原因)` **显式跳过**（报告中可见 skip，不是假绿）。
 *
 * 前置条件：后端 18990 + 前端 1420（playwright.config.ts 的 webServer，本地复用已运行实例）。
 * ⚠️ 若当前 shell 的环境变量 `CI` 为真，Playwright 会据此**禁用 `reuseExistingServer`**，
 * 从而报 "url is already used" 直接退出 ⇒ 本地跑需先清掉：PowerShell `$env:CI=""`（或 `unset CI`）。
 */

test.describe("轨迹模块 E2E", () => {
  // 视口加高（默认 1280×720）：检查器内部是「标题 + 播放器 + 过滤器 + 时间线 + 列表」
  // 纵向堆叠，720px 下事件行被挤到折叠线以下（实测行盒子 y=696，已越出视口）
  // ⇒ 真实指针点击无法稳定命中（首版即因此失败）。
  test.use({ viewport: { width: 1440, height: 1200 } });

  /** 打开轨迹 Tab：收起态点图标展开并切 Tab，展开态则直接判定为已展开 */
  async function openTrajectoryTab(page: Page) {
    await page.goto("/chat");
    await expect(page.locator("body")).toBeVisible({ timeout: 15_000 });

    // 前置条件（2026-09-23 补）：**必须有选中会话**，否则轨迹 Tab 只显示"还没有选中会话。"
    // ⇒ 依赖事件行的用例全部落空。实测本地出现过"未自动选中会话"（原因未定，**与轨迹模块改动无关**），
    // 故本 spec **自建前置条件**、不再依赖环境自动恢复；空库（CI）时保持原样，由用例显式 skip。
    await page.waitForTimeout(2000);
    // **优先挑"有对话轮次"的会话**：本仓存在大量僵尸会话（`messages.jsonl` 丢失），
    // 后端 K-6 会将其软删除（实测日志：`K-6 loadMessages: messages.jsonl 丢失但 session.json 存在`）
    // ⇒ 这类会话打开后**没有事件**，轨迹列表为空。列表里带"N 轮对话"的才更可能有消息与事件。
    const withTurns = page.getByRole("button").filter({ hasText: /轮对话/ });
    const candidates =
      (await withTurns.count()) > 0
        ? withTurns
        : page.getByRole("button").filter({ hasText: /【Web】/ });
    if ((await page.getByText("还没有选中会话。").count()) > 0) {
      if ((await candidates.count()) > 0) {
        await candidates.first().click();
        await page.waitForTimeout(2500);
      }
    }

    // 收起栏图标 title 形如"展开到轨迹 Tab"（ChatInspector.tsx CollapsedBar）；
    // 展开态无此按钮 ⇒ 已展开时无需点击。
    const collapsedIcon = page.locator('button[title="展开到轨迹 Tab"]');
    const collapseToggle = page.locator('button[title="收起面板"]');

    // **必须等**两态之一出现再判断：`count()` 不自动等待，Inspector 尚未挂载时会取到 0
    // ⇒ 点击被静默跳过（首版实测踩到此坑：等待 10s 后仍停在收起态）。
    await expect(collapsedIcon.or(collapseToggle).first()).toBeVisible({
      timeout: 15_000,
    });
    if ((await collapsedIcon.count()) > 0) {
      await collapsedIcon.first().click();
    }
    await expect(collapseToggle).toBeVisible({ timeout: 10_000 });

    // 展开后的面板根（含"收起面板"按钮的最内层 div）；用于把后续定位**限定在检查器内**，
    // 避免与聊天区/侧栏中同名的 data-index、#seq 等元素串味。
    const inspector = page
      .locator("div")
      .filter({ has: collapseToggle })
      .last();
    await expect(inspector).toBeVisible({ timeout: 10_000 });

    // 事件日志是较新的能力：本机存在"有消息但无事件"的旧会话 ⇒ 逐个候选尝试，
    // 直到轨迹列表出现事件行（最多 4 个）。空库（CI）时 candidates 为空、循环不执行，
    // 由各用例的 `requireRows` 统一 skip。
    const rows = inspector.locator("[data-index]");
    for (let i = 1; i <= 3; i++) {
      await page.waitForTimeout(1500);
      if ((await rows.count()) > 0) break;
      const next = candidates.nth(i);
      if ((await next.count()) === 0) break;
      await next.click();
      await page.waitForTimeout(2500);
    }
    return inspector;
  }

  /**
   * 行依赖用例的统一前置（2026-09-23 补）：等到"有行"或"确认无数据"二者之一成立，
   * 再判定是否需要 `test.skip`。**为什么要它**：此前这几个用例直接 `poll(行数 > 1)`，
   * 在空库/未选中会话时会**超时失败**（而非跳过）⇒ 属潜在 CI 红灯（同一坑此前只在第 3 例修过）。
   */
  async function requireRows(inspector: Locator): Promise<void> {
    const rows = inspector.locator("[data-index]");
    await expect
      .poll(
        async () =>
          (await rows.count()) > 0 ||
          (await inspector.getByText(/还没有选中会话|暂无|无匹配|条/).count()) >
            0,
        { timeout: 20_000 },
      )
      .toBe(true);
    if ((await rows.count()) < 2) {
      test.skip(true, "无可用的轨迹事件行（空库或未选中会话）");
    }
  }

  test("展开轨迹 Tab：五个 Tab 标签与轨迹内容区均渲染", async ({ page }) => {
    const inspector = await openTrajectoryTab(page);

    // 五个 Tab 标签（ChatInspector.tsx TABS）；严格用 title 精确匹配，
    // 避免命中收起栏的"展开到轨迹 Tab"。
    for (const label of ["上下文", "轨迹", "文件", "日志", "设置"]) {
      await expect(
        inspector.locator(`button[title="${label}"]`).first(),
      ).toBeVisible({ timeout: 10_000 });
    }

    // 轨迹内容区：三种合法终态之一 —— 未选会话 / 时间线（可成图）/ 时间线不可用。
    // 用计数判断而不是 .or()：标题与空态可能同屏，strict mode 会直接报错。
    await expect
      .poll(
        async () => {
          const noSession = await inspector
            .getByText("还没有选中会话。")
            .count();
          const timeline = await inspector.getByText("时间线").count();
          return noSession + timeline;
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
  });

  test("轨迹列表渲染事件行、空状态或未选会话提示（双态容错）", async ({
    page,
  }) => {
    const inspector = await openTrajectoryTab(page);

    // 有事件 → 虚拟行（data-index）> 0；无事件 → "暂无事件"/"无匹配事件"；
    // 未选会话 → "还没有选中会话。"。任一出现即为通过（不假设库里有数据）。
    await expect
      .poll(
        async () => {
          const rows = await inspector.locator("[data-index]").count();
          const empty = await inspector
            .getByText(/暂无事件|无匹配事件|还没有选中会话。/)
            .count();
          return rows + empty;
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
  });

  test("选中一条记录后详情面板渲染（回归「默认导出缺失」类装配缺陷）", async ({
    page,
  }) => {
    const inspector = await openTrajectoryTab(page);

    // 虚拟行是**混合区**：Turn 分组头是 `<button>`，事件行才是 `<div>`（ChatInspector.tsx:
    // 482-532）。只挑事件行 —— 点 Turn 头只会折叠该 turn，不会选中记录。
    const rowWrappers = inspector
      .locator("[data-index]")
      .filter({ has: page.locator("div") });

    const emptyState =
      inspector.getByText(/暂无事件|无匹配事件|还没有选中会话。/);

    // 等**两态**之一出现：`loadEvents` 是异步的，直接 `count()` 会在事件到达前取到 0
    // ⇒ 造成"假 skip"；但**只等"有行"**会在空库（CI 全新环境）上必然 poll 超时**失败**
    // ⇒ 必须把"确认无数据"也算收敛（2026-09-23 修正：首版只等有行）。
    // 空态文案来源：ChatInspector.tsx（`暂无事件` / `无匹配事件` 在列表分支，`还没有选中会话。` 在无会话分支）。
    await expect
      .poll(
        async () => (await rowWrappers.count()) + (await emptyState.count()),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);

    const rowCount = await rowWrappers.count();
    // skip 原因带上表头（"{{shown}}/{{total}} 条 · tailSeq={{n}}"），便于区分
    // "真的没数据" 与 "数据没加载出来"。
    const headerCount = await inspector.getByText(/tailSeq=/).count();
    const headerText = headerCount
      ? (
          (await inspector
            .getByText(/tailSeq=/)
            .first()
            .textContent()) ?? ""
        ).trim()
      : "（无表头：未选中会话）";
    test.skip(rowCount === 0, `无轨迹事件行，表头：${headerText}`);

    await rowWrappers.first().click();

    // 详情面板头部：关闭按钮 aria-label="关闭详情" + "复制 JSON"（TrajectoryDetail.tsx）。
    // 这两处正是当年"默认导入拿到 undefined"会整体不渲染的位置。
    await expect(
      inspector.locator('button[aria-label="关闭详情"]'),
    ).toBeVisible({ timeout: 10_000 });
    await expect(inspector.getByText("复制 JSON")).toBeVisible();

    // 关闭后详情面板消失（交互闭环）
    await inspector.locator('button[aria-label="关闭详情"]').click();
    await expect(
      inspector.locator('button[aria-label="关闭详情"]'),
    ).toHaveCount(0);
  });

  // TC-1（2026-09-23）：`TrajectoryTimeline` 的**几何交互**只能在此覆盖 ——
  // jsdom 的 `getBoundingClientRect` 恒为 0，纯函数（视图数学）已在单测 100% 覆盖，
  // 缺的正是"真实指针 + 滚轮 → 像素↔时间换算 → setView"这条接线。
  test("时间线交互：拖选聚焦 → 重置 → 滚轮缩放 → 右键平移", async ({
    page,
  }) => {
    const inspector = await openTrajectoryTab(page);
    // 先确保有行（无会话/空库 ⇒ 显式 skip，而非超时失败），再判定时间线是否可用
    await requireRows(inspector);

    // 时间线可能不可用（事件不足 / 时间域退化，如 CI 空库）⇒ 显式跳过而非假绿
    await expect
      .poll(async () => (await inspector.getByText(/时间线/).count()) > 0, {
        timeout: 15_000,
      })
      .toBe(true);
    if ((await inspector.getByText(/时间线不可用/).count()) > 0) {
      test.skip(true, "时间线不可用（事件不足或时间域退化）");
    }

    // 轨道：组件里带 pointer 处理器的 div（`div.select-none.touch-none`）
    const track = inspector.locator("div.select-none.touch-none").first();
    await expect(track).toBeVisible({ timeout: 10_000 });
    const box = await track.boundingBox();
    expect(box).not.toBeNull();
    const b = box as NonNullable<typeof box>;
    const y = Math.round(b.y + b.height / 2);
    const at = (ratio: number) => Math.round(b.x + b.width * ratio);

    // ① 拖选聚焦（位移 > 组件 3px 阈值 ⇒ 视为选区而非点击）
    await page.mouse.move(at(0.2), y);
    await page.mouse.down();
    await page.mouse.move(at(0.6), y, { steps: 8 });
    await page.mouse.up();
    await expect(inspector.getByText(/已聚焦/)).toBeVisible({ timeout: 5_000 });

    // ② 重置视图 ⇒ 回到全时间域（「已聚焦」消失、按钮同时卸载）
    await inspector.getByRole("button", { name: "重置视图" }).click();
    await expect(inspector.getByText(/已聚焦/)).toHaveCount(0);

    // ③ 滚轮缩放（deltaY < 0 ⇒ 放大）⇒ 再次聚焦
    await track.hover();
    await page.mouse.wheel(0, -120);
    await expect(inspector.getByText(/已聚焦/)).toBeVisible({ timeout: 5_000 });

    // ④ 右键平移（仅聚焦态生效）⇒ 仍在聚焦态且未崩
    await page.mouse.move(at(0.5), y);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(at(0.3), y, { steps: 6 });
    await page.mouse.up({ button: "right" });
    await expect(inspector.getByText(/已聚焦/)).toBeVisible();
    // 右键不应弹出浏览器菜单（组件已 preventDefault）—— 以"仍聚焦"作为副作用未被破坏的判据
  });

  /**
   * P2-5（2026-09-23）：对标"虚拟行结构缓存 / 仅内容变更不重写滚动"这条**断言**原本缺失。
   *
   * 静态证据（`ChatInspector.tsx:326-338`）：`allRows`/`flatRows` 均 `useMemo`（引用稳定，
   * 且 `filterCollapsedTurns` 空集提前返回同引用）；`getItemKey` 用**行自带稳定 key**
   * ⇒ 内容变更时 React 复用同一 DOM 节点，不应重建滚动容器。
   *
   * **为何用"回放推进"而非"点选行"作为触发**：首次实现用"点选行"⇒ 实测 `scrollTop`
   * 从 19873 变 19240（−633px）。查因：`TrajectoryDetail` 是**同一 flex 列的兄弟节点**
   * （`ChatInspector.tsx:549-555`）⇒ 打开详情即压缩列表高度、浏览器**钳制** `scrollTop`
   * —— 属**布局挤压**（同 TB-1 家族，已登记 TB-6），**不是"重写滚动"**。
   * 故改用**布局中性**的触发（播放器推进 ⇒ 仅行高亮变）来**隔离** P2-5 想验证的性质。
   */
  test("滚动写入：仅内容变更（回放推进）不重写滚动容器、scrollTop 不变（P2-5）", async ({
    page,
  }) => {
    const inspector = await openTrajectoryTab(page);
    await requireRows(inspector);

    // 行 → 内层容器（height=getTotalSize 的相对定位层）→ 滚动容器
    const inner = inspector.locator("[data-index]").first().locator("xpath=..");
    const scroller = inner.locator("xpath=..");
    await inner.evaluate((el) => el.setAttribute("data-probe", "p2-5"));

    await scroller.evaluate((el) => {
      el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 2);
    });
    await page.waitForTimeout(400);
    const before = await scroller.evaluate((el) => el.scrollTop);
    // 前提断言：必须真的滚到了中部，否则"scrollTop 不变"是平凡通过
    expect(before).toBeGreaterThan(0);

    // 仅内容变更：回放推进（`playbackIndex` 变化 ⇒ 选中行高亮迁移）；不改行集、不改布局高度
    await inspector.getByRole("button", { name: "播放" }).click();
    await page.waitForTimeout(900); // 1x ⇒ 600ms/行 ⇒ 至少推进 1 行
    await inspector.getByRole("button", { name: "暂停" }).click();
    await page.waitForTimeout(250);

    // ① scrollTop 未被重置/未移动 ② 内层 DOM 节点未被重建（标记仍在）
    expect(await scroller.evaluate((el) => el.scrollTop)).toBe(before);
    expect(await inner.getAttribute("data-probe")).toBe("p2-5");
  });

  /**
   * TB-6 回归（2026-09-23，**方案 B 根治后**）：
   * 打开详情**不得**移动列表滚动位置。三个阶段的实测：
   * ① 修复前 `scrollTop` 19873 → 19240（−633px）—— 详情曾是滚动容器的**兄弟节点**、打开时占走列表高度、可滚动范围收缩被浏览器钳制；
   * ② 方案 A（行内展开）消除①，但仍有确定性 +400（=详情高度）—— 诊断证明是**浏览器内部**把
   *    `scrollTop` 同步 +Δ（无 JS 参与、`overflow-anchor:none` 无效）；
   * ③ 方案 B（**移出滚动内容流**，面板级绝对定位浮层）⇒ 内容高度零变化 ⇒ 两个触发条件一并消失。
   *
   * 注意：**必须点一个当前已在视口内的事件行** —— 若让 Playwright 自动滚入，
   * 滚动位置会被 `click()` 改变，断言就失去意义。
   */
  test("点选行（打开详情）不再移动列表滚动位置（TB-6 回归）", async ({
    page,
  }) => {
    const inspector = await openTrajectoryTab(page);
    await requireRows(inspector);

    const inner = inspector.locator("[data-index]").first().locator("xpath=..");
    const scroller = inner.locator("xpath=..");
    await scroller.evaluate((el) => {
      el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 2);
    });
    await page.waitForTimeout(400);
    const before = await scroller.evaluate((el) => el.scrollTop);
    expect(before).toBeGreaterThan(0); // 前提：确实处于中部

    // 找一个**完全落在可视区内**的事件行（Turn 头是 button，故过滤含 div 的行）
    const sBox = await scroller.boundingBox();
    expect(sBox).not.toBeNull();
    const rows = inspector
      .locator("[data-index]")
      .filter({ has: page.locator("div") });
    let target: ReturnType<typeof rows.nth> | null = null;
    for (let i = 0; i < (await rows.count()); i++) {
      const b = await rows.nth(i).boundingBox();
      if (
        b &&
        sBox &&
        b.y > sBox.y + 5 &&
        b.y + b.height < sBox.y + sBox.height - 5
      ) {
        target = rows.nth(i);
        break;
      }
    }
    expect(target).not.toBeNull();
    await target?.click();

    // 详情确实打开了
    await expect(
      inspector.locator('button[aria-label="关闭详情"]'),
    ).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(300);

    const after = await scroller.evaluate((el) => el.scrollTop);
    console.log(
      `[TB-6] scrollTop before=${before} after=${after} Δ=${after - before}`,
    );
    // ✅ TB-6 **方案 B（2026-09-23）后断言"完全不动"**：详情已移出滚动内容流（面板级绝对定位浮层），
    //    展开时滚动容器内容高度**零变化** ⇒ 不再触发"内容高度 +Δ ⇒ 浏览器内部把 scrollTop 同步 +Δ"
    //    （该内部行为已实测证明**无 JS 参与**、`overflow-anchor:none` 无效 ⇒ 只能消除触发条件）。
    //    同时也不再出现"详情挤压列表 ⇒ clientHeight 变小 ⇒ scrollTop 被钳制"（曾实测 −633px）。
    //    容差 1px：仅防亚像素滚动取整，**不代表允许位移**。
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  });

  /**
   * API 指标展示（2026-09-23，`.trae/specs/api-metrics-surface.md`）：
   * 「请求指标」分区**双态**渲染 —— 有请求级 `metric/timing` 数据 ⇒ 显示统计；
   * 无请求级数据 ⇒ 显示"暂无请求指标"提示（**不**拿 0 / `-` 冒充数据）。
   *
   * 数据依赖：本机会话可能无 `metric/timing`（旧会话）⇒ 两态**都在本用例内动态判定**，
   * 不写入任何数据准备；空库由 `requireRows` 显式 skip（沿用本 spec 既有策略）。
   */
  test("请求指标分区：双态渲染（有数据 ⇒ 统计；无数据 ⇒ 明确提示）", async ({
    page,
  }) => {
    const inspector = await openTrajectoryTab(page);
    await requireRows(inspector);

    // 分区装配探针：两态都含"请求指标"字样（有数据 ⇒ 标题；无数据 ⇒ "暂无请求指标"）
    const sectionProbe = inspector.getByText(/请求指标/).first();
    await expect(sectionProbe).toBeVisible({ timeout: 10_000 });

    const emptyHint = await inspector.getByText("暂无请求指标").count();
    if (emptyHint > 0) {
      // 无请求级数据态：只允许提示文案，不得出现任何统计数值
      await expect(inspector.getByText(/请求级事件 \d+ 条/)).toHaveCount(0);
      await expect(inspector.getByText(/TTFT p50/)).toHaveCount(0);
      return;
    }

    // 有请求级数据态：事件计数必须出现，且至少有一个真实指标项（延迟分位 / token 分桶）
    await expect(inspector.getByText(/请求级事件 \d+ 条/)).toHaveCount(1);
    const latencyShown = await inspector.getByText(/TTFT/).count();
    const tokensShown = await inspector
      .getByText(/输入 .* · 输出 .* · 合计/)
      .count();
    expect(latencyShown > 0 || tokensShown > 0).toBe(true);
  });
});
