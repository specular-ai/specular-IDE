# Spec Kitty discovery

An example installed profile, a plugin package with a discovery contribution (increment 97c). It proposes the conventions of [Spec Kitty](https://github.com/Priivacy-ai/spec-kitty) projects in **Project configuration > Discover > Discover by patterns**, reading only the `markdown@1` model. It is plain JavaScript, so it installs without a build: choose **Project > Install profile folder…** and select this folder. **Project > Manage profiles…** lists it, where it can be disabled or uninstalled.

Spec Kitty writes each work package as `<root>/<feature>/tasks/WPnn-<slug>.md` (usually `kitty-specs/`). Its YAML front matter holds `work_package_id`, `subtasks` (`T001`…), `dependencies`, and the lane `history`, and its title heading repeats the ID (`# Work Package Prompt: WP01 – …`). From at least two such prompt files, the plugin proposes:

- **Work package**: `\bWP\d+\b`, one scope per feature folder (`kitty-specs/*`), defined by the level-1 title heading of the prompt files (definition path `kitty-specs/*/tasks/*.md`). Mentions in `tasks.md` and elsewhere refer to them.
- **Subtask**: `\bT\d{3,}\b`, per feature folder, defined by the checkbox items of the feature's `tasks.md` that start with a subtask listed in front matter. Specular's own `T` suggestion may cover the same IDs; keep one of them.

It reports as **gaps**, which are never applied: dependencies between work packages (front matter lists and `Depends on WP01` lines in `tasks.md`), which subtasks belong to which work package, the lanes recorded in front matter, prompt files whose title does not repeat the ID, and work packages that appear only in `tasks.md`, without a prompt file.

It applies where at least two prompt files match `**/kitty-specs/*/tasks/*.md` (`discovery.applies`), so it is off in other projects unless turned on. On a large project, limit **Markdown scope** to `kitty-specs/`.
