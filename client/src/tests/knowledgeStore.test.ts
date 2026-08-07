/**
 * knowledgeStore list slice 回归测试（P3-1）
 *
 * 覆盖 useKnowledgeBaseList useReducer 收编进 knowledgeStore 后的关键状态迁移：
 * 搜索三态统一（search slice 单一事实）、选择集不可变更新、分页加载、新建表单重置。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  useKnowledgeStore,
  createInitialListState,
} from "../stores/knowledgeStore";
import type { KnowledgeFile } from "../types";

function makeFile(id: string): KnowledgeFile {
  return {
    id,
    title: `doc-${id}`,
    content: "",
    tags: [],
    category: "",
    docPath: `${id}.md`,
    size: 0,
    updated_at: 0,
    created_at: 0,
    source: "manual",
    base: "main",
  };
}

beforeEach(() => {
  useKnowledgeStore.setState({ list: createInitialListState() });
});

describe("knowledgeStore list slice (P3-1 收编)", () => {
  it("SET_SEARCH_QUERY 写入 search slice（搜索状态单一事实）", () => {
    useKnowledgeStore.getState().dispatchList({
      type: "SET_SEARCH_QUERY",
      query: "rag",
    });
    expect(useKnowledgeStore.getState().search.query).toBe("rag");
  });

  it("SET_SEARCHING + SET_SEARCH_RESULTS → listResults 落地且搜索态关闭", () => {
    const s = useKnowledgeStore.getState();
    s.dispatchList({ type: "SET_SEARCHING", searching: true });
    s.dispatchList({ type: "SET_SEARCH_RESULTS", results: [makeFile("a")] });
    const { search } = useKnowledgeStore.getState();
    expect(search.listResults).toHaveLength(1);
    expect(search.listResults[0].docPath).toBe("a.md");
    expect(search.isListSearching).toBe(false);
  });

  it("TOGGLE_FILE_SELECTION 不可变更新选择集（重复点击取消）", () => {
    const s = useKnowledgeStore.getState();
    s.dispatchList({ type: "TOGGLE_FILE_SELECTION", id: "a" });
    s.dispatchList({ type: "TOGGLE_FILE_SELECTION", id: "b" });
    s.dispatchList({ type: "TOGGLE_FILE_SELECTION", id: "a" });
    const ids = useKnowledgeStore.getState().list.selectedFileIds;
    expect(ids.has("a")).toBe(false);
    expect(ids.has("b")).toBe(true);
    expect(ids.size).toBe(1);
  });

  it("SET_FILES 更新 files/total 并关闭 loading", () => {
    const s = useKnowledgeStore.getState();
    s.dispatchList({ type: "SET_LOADING", loading: true });
    s.dispatchList({ type: "SET_FILES", files: [makeFile("a")], total: 12 });
    const { list } = useKnowledgeStore.getState();
    expect(list.files).toHaveLength(1);
    expect(list.total).toBe(12);
    expect(list.loading).toBe(false);
  });

  it("OPEN_CREATE_MODAL 重置新建表单与状态", () => {
    const s = useKnowledgeStore.getState();
    s.dispatchList({ type: "SET_NEW_BASE", field: "name", value: "旧值" });
    s.dispatchList({ type: "OPEN_CREATE_MODAL" });
    const { list } = useKnowledgeStore.getState();
    expect(list.showCreateModal).toBe(true);
    expect(list.newBaseName).toBe("");
    expect(list.newBaseLabel).toBe("");
    expect(list.newBaseIcon).toBe("");
    expect(list.createStatus).toBe("idle");
  });

  it("SET_COMPILE_STATUS + CLEAR_COMPILE 闭环", () => {
    const s = useKnowledgeStore.getState();
    s.dispatchList({ type: "SET_COMPILE_STATUS", status: "compiling" });
    s.dispatchList({ type: "SET_COMPILE_MESSAGE", message: "编译中" });
    expect(useKnowledgeStore.getState().list.compileStatus).toBe("compiling");
    s.dispatchList({ type: "CLEAR_COMPILE" });
    expect(useKnowledgeStore.getState().list.compileStatus).toBe("idle");
    expect(useKnowledgeStore.getState().list.compileMessage).toBe("");
  });
});
