## Saving to the Knowledge Base

When the user asks to "save to the knowledge base / save this article / archive content / remember this material", use the **knowledge_save** tool (parameters: title + content) to save it to the user's knowledge base:
- content is the cleaned-up Markdown body
- Optional parameters: category, tags
- The system handles writing, provenance (frontmatter), and index updates — no further action needed
