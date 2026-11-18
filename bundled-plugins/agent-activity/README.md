# Bundled Agent activity

Increment 95b (REQ-225, DD-061). One custom view, **Agent activity**, that answers "what have the coding agents been doing in this project, and where did they fail?" from the public `activity@1` and `physical@1` models only. It uses plugin API 0.2 and custom API version 1 session state; Specular's core is unchanged.

Activity is what Claude Code and Codex logged on this computer while working in the project folder or one of its subfolders. Specular reads it only after **Agent setup > Read agent sessions for this project** is turned on; nothing leaves the machine, and there is no message text.

- **Header.** Sessions, turns, tool calls, and failures in all; logs read and lines skipped per agent, and when a limit was reached; the model's warnings.
- **Filters.** Agent, a date range (local days; a session matches when it overlaps the range), and one session, shared by the three tabs. **Clear filters** resets them.
- **Sessions.** Newest first, with agent, title (the agent's own, or the session id), start, duration, branch, folder when not the project root, model, turns, tool calls, and failures. A session expands into its turns, and a turn into its tool calls with time, tool, kind, files or command, and outcome (`failed` with its exit code, `denied`, `no result`); failed calls are marked and subagent calls labelled. Choosing a session in the filter opens it. **Only sessions with failures** hides sessions without a failure and, inside the others, turns without one.
- **Resources.** Project files named by tool calls, most used first: reads, writes, and other mentions (searches and commands that name a file), the sessions that touched them, and the last access. Specification files (the project's Markdown documents in the physical model) are marked, can be shown alone, and open in Specular; other files are listed without a link. Paths outside the project are counted, not listed.
- **Commands.** Shell commands grouped by their first words, most used first, with calls, failures, sessions, and the last outcome; a group expands into its 50 newest calls. **Only commands with failures** keeps the groups with at least one failure. Grouping skips leading folder changes (`cd x &&`), environment and PowerShell variable assignments, `sudo`/`env` wrappers, and program paths; it keeps one subcommand (`git status`, also after `git -c key=value`) or, for runners, two words (`npx playwright test`, `npm run build`); file commands and PowerShell cmdlets (`ls`, `grep`, `Get-Content`) and shell keywords (`for`, `if`) are grouped by name alone. Splitting ignores separators inside quotes and `$(…)`. A PowerShell here-string piped into a program is grouped by that program, or as **PowerShell here-string** when the 500-character command text was clipped before it.
- **Repeated failures.** A group that failed at least 3 times in one session is marked **Repeated failure in N sessions**: the first signal of an agent struggling.
- **Empty states.** Reading off (pointing to Agent setup), reading in progress, no sessions for the project, and no sessions matching the filters.
- **Limits.** At most 500 sessions, command groups, or files are listed, and 500 tool calls per turn; narrow the filters to see others. The model itself holds at most 500 sessions and 20,000 tool calls.

The tab, filters, expanded sessions and command groups, and the three checkbox choices are kept in session state, so they survive opening a file and returning.

Everything shown is what the agents recorded, not verified; edits made through shell commands appear as commands, not writes.

Build independently like the Project map (`bundled-plugins/relationships`): install a locally packed `@specular/plugin-api`, TypeScript, and esbuild, then run `npm run build` and `npm run validate`. `npm run test:sdk` in Specular checks this independent build. The application build places the package under `dist/bundled-plugins/agent-activity`.
