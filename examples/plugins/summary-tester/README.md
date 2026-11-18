# Summary tester example

A minimal custom view for trying the summary service of increment 94a (custom API version 2, `summary.generate`). It lists the configured features, and its buttons call `context.summaries.get`, `generate`, and `cancel` for `{ kind: 'feature', key }`, showing the returned `SummaryRecord` as JSON. It is a test harness, not a finished view: the feature dossier's summary box (94b) presents summaries properly.

The plugin cannot send text of its own to a model. Specular builds the input from its project and physical models, asks once per project before sending it to Codex or Claude Code, runs one turn without tools, and stores the result in the project's `.specular/summaries/feature/<key>.json`. Agent setup shows when a project allows summaries and can stop allowing them.

The entry is plain ESM JavaScript, so there is nothing to build. In Specular, choose **Abstractions > Install abstraction folder…** and select this directory, then open a project with configured features (for example a copy of `examples/harbor`). Try **Get stored**, **Generate** (refusing and then allowing consent), editing a member ID's title or status and **Get stored** again to see `changes`, and **Cancel** during a generation. Claude Code uses the executable from Agent setup or PATH; Codex must be connected in Agent setup.
