const STOP_WORDS_EN = new Set([
  "a", "an", "the", "this", "that", "these", "those",
  "i", "me", "my", "we", "our", "you", "your", "he", "she", "it", "they", "them",
  "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did",
  "will", "would", "could", "should", "can", "may", "might",
  "in", "on", "at", "to", "for", "of", "with", "by", "from",
  "about", "into", "through", "during", "before", "after",
  "above", "below", "between", "under", "over",
  "and", "or", "but", "if", "then", "because", "as", "while",
  "when", "where", "what", "which", "who", "how", "why",
  "yesterday", "today", "tomorrow", "earlier", "later", "recently", "ago", "just", "now",
  "thing", "things", "stuff", "something", "anything", "everything", "nothing",
  "please", "help", "find", "show", "get", "tell", "give",
]);

const STOP_WORDS_ZH = new Set([
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
  "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着",
  "没有", "看", "好", "自己", "这", "他", "她", "它", "们",
  "什么", "怎么", "哪", "为什么", "如何", "谁",
  "请", "帮", "找", "显示", "告诉", "给",
]);

const STOP_WORDS = new Map([
  ["en", STOP_WORDS_EN],
  ["zh", STOP_WORDS_ZH],
]);

export function isQueryStopWordToken(token: string): boolean {
  const trimmed = token.trim().toLowerCase();
  if (!trimmed || trimmed.length <= 1) {
    return true;
  }
  for (const wordSet of STOP_WORDS.values()) {
    if (wordSet.has(trimmed)) {
      return true;
    }
  }
  return false;
}

export function extractKeywords(query: string): string[] {
  if (!query || query.trim().length === 0) {
    return [];
  }

  const tokens = query
    .toLowerCase()
    .split(/[\s,;:.!?，；：。！？、()（）[\]【】"「」'‘’"“”]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const token of tokens) {
    if (isQueryStopWordToken(token)) {
      continue;
    }
    const normalized = token.replace(/^[^a-zA-Z0-9\u4e00-\u9fff]+|[^a-zA-Z0-9\u4e00-\u9fff]+$/g, "");
    if (normalized.length > 0 && !seen.has(normalized)) {
      seen.add(normalized);
      keywords.push(normalized);
    }
  }

  return keywords;
}
