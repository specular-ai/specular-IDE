# A small idea, connected.

Welcome to your first **Specular** workspace. This project describes a focus timer, from its requirements and user stories to its domain and state models.

## Follow the intent

The timer starts with REQ-001. Select that ID in this preview to jump to its definition in another file. The references panel shows everywhere it is mentioned.

Try **Ctrl-click** on an ID in the editor, or place the cursor on it and press **F12**. **Shift-F12** finds its references.

## Inspect relationships

In **Project Lens → Index**, search for REQ-001 and choose **Relationships** on its card. Expand DD-001 to see the source lines that reference the requirement. Click evidence to select that mention in design.md, or choose **Open definition** to visit the decision. The list updates with unsaved edits; a reference shows a recorded connection, not proof of implementation. **All occurrences** on any ID card also includes mentions outside requirement/decision definitions.

Choose **Explore map** on a requirement/decision card to open the **Relationships** workspace tab. Select a line or an entry in its Connection list to inspect evidence, then click a passage to open its source. Click a node's ID to open its definition or **Focus ID** to explore its neighbors. Search for another focus, filter by the file containing the reference, and use Previous/Next for more than six connections. Returning to the map retains your view and unsaved edits; closing it keeps document tabs open. This view shows explicit REQ/DD and DD/TASK paths in three columns. Define tasks with headings such as `## TASK-001 - Review the timer transitions` and mention DD-001 in the section, or use an ID table row. Search for the task in Project Lens to explore the path back to requirements. The second-hop connections have their own six-entry pages, and missing/duplicate decisions are not expanded. Authored tasks and statuses are not verified implementation or agent execution records.

For the whole recorded model, choose **Dependency overview** in Project Lens or **Overview** in the Relationships tab. All IDs and directed connections appear together in a visual graph, arranged by file. Drag the background to pan, zoom with the wheel or controls, and choose **Fit all** to see the entire graph. Click a node to highlight its connections and show details; click a link for source evidence. Lists remain available as an optional fallback. Select an ID to see all incoming/outgoing references, then **Trace recorded paths** to follow a multi-step chain and inspect each hop's source evidence. Self-references, isolated IDs, and missing/duplicate definitions remain visible; ambiguous definitions stop path traversal. **Focus** returns to the requirements/design/task diagram. Unsaved changes refresh both modes.

External plugins can be built separately and installed locally through the public SDK. Implementation-task relationships are available in increment 23; shared view infrastructure in 29 is also delivered. Focus and Overview retain their session state on source return and close/reopen. Increments 30-33 provide the SDK, isolated runtime, custom interfaces, and persistent installation. Build the standalone specification-index or document-timeline example with `npm.cmd run test:sdk` from the Specular repository, then choose Project Lens > Install plugin folder... and select the corresponding path from `.cache/plugin-sdk/example-path.txt` or `.cache/plugin-sdk/timeline-example-path.txt`. The timeline recognizes ISO-date-prefixed list entries in the current document and opens their source evidence. Richer dates and project-wide timelines remain later increments.

## Try the task layer

Open [Implementation tasks](tasks.md) for five sample work items, defined using both headings and table rows. Explore REQ-001 to see four tasks through DD-001, or focus TASK-002 to follow the path back to requirements. Overview also shows direct task/requirement and task/task references. TASK-005 demonstrates an unlinked task. The task file includes a short testing walkthrough.

## Explore the system

- [Requirements](requirements.md) — what the timer should do.
- [User stories](stories.md) — a user journey as a live Mermaid diagram.
- [Design](design.md) — decisions and a live Mermaid state diagram.
- [Domain model](domain.md) — the timer's concepts as a live Mermaid class diagram.
- [Implementation tasks](tasks.md) - sample work items for the relationship views.
- [Agent instructions](AGENTS.md) — project configuration, kept in Markdown.
- [Implementation sketch](src/timer.ts) — a read-only code example.

## Browse the folders

Expand **src** in the explorer and open **timer.ts** to inspect the code. Collapse the folder to tidy the view. Filtering for **timer.ts** shows the file under its parent folder. You can also use arrow keys to navigate and expand folders, then Enter to open a file. Markdown files retain their pending-item badges.

## Make a small change

Edit a paragraph on the left. The preview updates as you type. Save with **Ctrl-S**. Your changes remain ordinary Markdown files.

Open the **Issues** tab in the project lens to find the decisions still waiting for an answer.

## Resize the panels

Drag the divider between source and preview to give either panel more space. Focus the divider and use Left/Right for keyboard adjustment; hold Shift for smaller steps. Click **50/50** in the document toolbar or press Enter on the divider to reset. The split stays while switching documents, and resizing preserves text selections for agent briefs.

## Close document tabs

Use a tab's **×** button or **Ctrl+W** to close the active tab. Unsaved edits offer **Save**, **Discard**, or **Cancel**. A failed save keeps the tab open. Closing every tab leaves the project available in the explorer; open a file again to continue.

## Prepare a brief

Select a requirement or paragraph in the source editor, the preview, or both, and choose **Prepare agent brief**. Choose which selections to use, enter an instruction, choose **Create brief**, then review and edit the assembled text before sending or copying it. The brief includes the selected text and its source information, with unsaved changes labeled. Preview text is labeled separately and has no exact source-line range; choosing both keeps overlapping content in both sections.

For a read-only discussion, connect Codex first and resolve any Resume/project choice in chat. In the brief review, check the project and model, then choose **Send to Codex chat**. The exact reviewed text becomes a message and chat opens for the streamed reply and follow-up. A failed send keeps your edits and Copy available. You can also copy the brief or insert it into a running project agent terminal and submit it yourself.

Send, copy, or insert before closing: unsent drafts are not saved. Preparation changes no Markdown and makes no model request. A chat send uses API credits and its existing read-only project context; sent text follows chat history persistence. Unsaved text is included only where you explicitly captured it; subsequent file reads use saved disk content.

## Connect built-in Codex chat

In **Agent setup**, enter an API key and optionally select **Remember API key on this device** and **Connect automatically when Specular starts**, then connect. Disconnect keeps a saved key; Forget key removes it. Keys are protected in Specular's Windows user-data folder, outside this demo. Automatic connection sends no prompts. Built-in chat messages survive restart and remain readable offline. After connecting, choose **Resume saved context** to continue the same conversation, or **Start fresh** to confirm clearing its transcript. Native terminal agents manage their own logins.

> This is an editable demo project. Specular stores its own copy, so you can experiment freely.
