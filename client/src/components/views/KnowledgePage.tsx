import { useEffect, useState } from 'react';
import { useKnowledgeStore } from '../../stores/knowledgeStore';
import { useAppStore } from '../../stores/appStore';
import { SkeletonCard } from '../common/Skeleton';

function KnowledgePage() {
  const store = useKnowledgeStore();
  const items = store.items || [];
  const { isLoading, searchQuery, loadItems, searchItems, createItem, updateItem, deleteItem, setSearchQuery } = store;
  const setActivePage = useAppStore((s) => s.setActivePage);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formTags, setFormTags] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editTags, setEditTags] = useState('');

  useEffect(() => {
    loadItems();
  }, []);

  const handleSearch = (value: string) => {
    setSearchQuery(value);
  };

  const handleSearchSubmit = () => {
    searchItems(searchQuery);
  };

  const handleCreate = async () => {
    if (!formTitle.trim() || !formContent.trim()) return;
    await createItem({
      title: formTitle.trim(),
      content: formContent.trim(),
      tags: formTags.split(',').map((t) => t.trim()).filter(Boolean),
    });
    setFormTitle('');
    setFormContent('');
    setFormTags('');
    setShowForm(false);
  };

  const startEdit = (item: typeof items[0]) => {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditContent(item.content);
    setEditTags((item.tags || []).join(', '));
  };

  const handleUpdate = async () => {
    if (!editingId || !editTitle.trim() || !editContent.trim()) return;
    await updateItem(editingId, {
      title: editTitle.trim(),
      content: editContent.trim(),
      tags: editTags.split(',').map((t) => t.trim()).filter(Boolean),
    });
    setEditingId(null);
  };

  const selectedItem = items.find((i) => i.id === selectedId);

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            知识库
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowForm(!showForm)}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded"
            >
              新增
            </button>
            <button
              onClick={() => setActivePage('chat')}
              className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded"
            >
              返回聊天
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearchSubmit()}
            placeholder="搜索知识条目..."
            className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleSearchSubmit}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
          >
            搜索
          </button>
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); loadItems(); }}
              className="px-3 py-2 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg"
            >
              清除
            </button>
          )}
        </div>

        {showForm && (
          <div className="mb-4 p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
              新增知识条目
            </h3>
            <div className="space-y-3">
              <input
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="标题"
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <textarea
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                placeholder="内容"
                rows={4}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              />
              <input
                type="text"
                value={formTags}
                onChange={(e) => setFormTags(e.target.value)}
                placeholder="标签 (逗号分隔)"
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCreate}
                  disabled={!formTitle.trim() || !formContent.trim()}
                  className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded"
                >
                  创建
                </button>
                <button
                  onClick={() => setShowForm(false)}
                  className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-4">
          <div className="flex-1 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            {isLoading ? (
              <div className="p-4 space-y-3">
                <SkeletonCard count={3} />
              </div>
            ) : items.length === 0 ? (
              <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                {searchQuery ? '无匹配结果' : '知识库为空'}
              </div>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {items.map((item) => (
                  <li
                    key={item.id}
                    onClick={() => {
                      setSelectedId(item.id);
                      setEditingId(null);
                    }}
                    className={`px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                      selectedId === item.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    }`}
                  >
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {item.title}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                      {item.content.slice(0, 80)}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      {(item.tags || []).map((tag) => (
                        <span
                          key={tag}
                          className="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {selectedItem && editingId !== selectedItem.id && (
            <div className="w-80 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden h-fit">
              <div className="p-4">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  {selectedItem.title}
                </h3>
                <p className="mt-3 text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
                  {selectedItem.content}
                </p>
                {(selectedItem.tags || []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {(selectedItem.tags || []).map((tag) => (
                      <span
                        key={tag}
                        className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500">
                  <div>创建: {new Date(selectedItem.created_at).toLocaleString('zh-CN')}</div>
                  <div className="mt-0.5">更新: {new Date(selectedItem.updated_at).toLocaleString('zh-CN')}</div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <button
                    onClick={() => startEdit(selectedItem)}
                    className="flex-1 px-3 py-1.5 text-sm text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => deleteItem(selectedItem.id)}
                    className="flex-1 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          )}

          {selectedItem && editingId === selectedItem.id && (
            <div className="w-80 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden h-fit">
              <div className="p-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                  编辑条目
                </h3>
                <div className="space-y-3">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="标题"
                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    placeholder="内容"
                    rows={6}
                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                  />
                  <input
                    type="text"
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    placeholder="标签 (逗号分隔)"
                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleUpdate}
                      disabled={!editTitle.trim() || !editContent.trim()}
                      className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded"
                    >
                      保存
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded"
                    >
                      取消
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default KnowledgePage;
