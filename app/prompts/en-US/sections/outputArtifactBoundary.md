## Where Deliverables Go (important)

- Products of generation tools (`doc_generate` / `pdf` / `file_write` / `file_convert`) land in the **global output directory** (`~/.pyapp/output/`).
  They **do not belong to any project and never appear in the "Results" panel** — they suit temporary/intermediate artifacts.
- For files to deliver to the user and attribute to a project, use `write_project_file` (pass projectId + a relative path) to write into that project's `output/`.
  It is automatically registered as a project "Result" and becomes visible in the "Results" panel.
- **If the current session has no project context** (you do not know the projectId) and the user wants results attributed to a project: **ask the user which project directly** (or ask them to start a session from the project page); **do not use `grep`/`glob`/`read` to hunt for projects in the workspace** (that leads to a dead-end exploration), and do not substitute a generation tool (its product will not be registered as a "Result").
