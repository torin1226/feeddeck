---
name: backlog
description: Manages the FeedDeck project backlog. Use this skill whenever starting work on the project, picking the next task, completing a task, discovering new work, hitting a blocker, or when the user asks about project status. Also trigger when the user says "what's next", "update the backlog", "mark that done", "I'm blocked", or references any task by name. Always consult this skill before writing code to ensure you're working on the right thing.
---

# Backlog Management Skill

You manage the FeedDeck backlog across two files. This is the contract between you and the user. Follow this protocol exactly.

---

## File Locations

- **`BACKLOG.md`** — The active backlog. All open, blocked, and decision-needed tasks live here. This is the file you read and update during work sessions.
- **`BACKLOG-ARCHIVE.md`** — Read-only archive of completed tasks. Completed milestones (M1, M2) are collapsed to one-line summaries in the main file; their full task lists plus all older completed items live here. Reference it when you need historical context, but never write to it during normal work.

If the main file doesn't exist or you can't find it, tell the user immediately. Don't guess or create a new one without asking.

## File Structure

The main backlog has this layout (top to bottom):

1. **Progress Summary table** — completion % per milestone at a glance
2. **Completed milestones** (M1, M2) — collapsed to summaries with links to archive
3. **Active milestones** (M3, M4, M5, M5a) — full task lists with sub-sections
4. **Discovered Tasks** — ad-hoc items found during implementation, including promoted design review items
5. **Completed (Recent)** — last 5 completed items for context, with link to full archive

---

## Status Markers

```
[ ]  — Not started
[~]  — In progress (you are actively working on this)
[x]  — Complete
[!]  — Blocked (always add a note explaining why)
[?]  — Needs decision from user (always add a note with the question)
```

---

## Protocol: Starting a Work Session

1. Read `BACKLOG.md` first. Always. The Progress Summary table gives you instant context.
2. Look for any `[~]` tasks (in-progress). If found, resume that work.
3. If no in-progress tasks, pick the next `[ ]` task using the priority rules below.
4. Mark the task `[~]` before writing any code.
5. Save the file.

**Priority rules for picking tasks:**
- Lower milestone number before higher (M3 before M4 before M5). M5a (Playback) is P0 — treat as highest priority if it has unblocked items.
- Within a milestone, go top to bottom (tasks are pre-ordered by dependency).
- If a task has dependencies that aren't `[x]`, skip it and pick the next one.
- Never start a higher milestone's tasks while a lower milestone has incomplete `[ ]` tasks, unless the user explicitly says to.
- M1 and M2 are complete — skip them entirely (collapsed in main file, details in archive).

---

## Protocol: Completing a Task

1. Verify the work is done (code written, tested if possible, no obvious issues).
2. Change the task from `[~]` to `[x]`, appending today's date: `(2026-04-25)`.
3. Move the completed task line to the `## Completed (Recent)` section at the bottom, prepending today's date.
4. If the Recent section exceeds 10 items, move the oldest ones to `BACKLOG-ARCHIVE.md` under `## Completed Tasks`.
5. Update the Progress Summary table if the milestone completion % changed.
6. Save the file.

**Format for completed tasks:**
```
- [x] (2026-03-20) Initialize Vite + React project with folder structure per SETUP.md
```

---

## Protocol: Discovering New Work

During implementation you'll often find tasks that weren't anticipated. Handle them like this:

1. Add the new task to the `## Discovered Tasks` section with `[ ]` status.
2. Include a brief note about why it's needed and which existing task surfaced it.
3. Don't move it into a milestone section yourself. The user will triage it.

**Format:**
```
- [ ] Add CORS headers to all API responses (discovered while building POST /api/videos — browser blocks cross-origin requests in dev)
```

**Exception:** If the discovered task is a small subtask that's clearly blocking your current work (like "install a missing dependency"), just do it. Don't add paperwork for 2-minute fixes.

---

## Protocol: Hitting a Blocker

1. Mark the task `[!]`.
2. Add a note on the next line explaining the blocker.
3. Pick the next available task and continue working.
4. Don't sit idle.

**Format:**
```
- [!] Backend: shell out to yt-dlp --dump-json to extract metadata
  > BLOCKED: yt-dlp not installed on this machine. User needs to install it first.
```

---

## Protocol: Needing a User Decision

1. Mark the task `[?]`.
2. Add a note with the specific question.
3. Continue with other tasks if possible.

**Format:**
```
- [?] Hover interaction: show 3-second preview gif/video
  > QUESTION: Should hover previews use actual video segments or static thumbnail sequences? Video is smoother but costs more bandwidth.
```

---

## Protocol: Reordering Priorities

The user may ask you to reprioritize. When they do:

1. Move the task(s) to the requested position.
2. If moving across milestones, add a note about why.
3. Don't reorder on your own. The existing order reflects user decisions.

---

## Protocol: Archiving a Completed Milestone

When ALL tasks in a milestone are `[x]`:

1. Move the full task list to `BACKLOG-ARCHIVE.md` under `## Completed Milestones`.
2. Replace the milestone section in `BACKLOG.md` with a one-line collapsed summary:
   ```
   ## Milestone N: Title — COMPLETE
   > All X tasks done. Details in [`BACKLOG-ARCHIVE.md`](BACKLOG-ARCHIVE.md).
   ```
3. Update the Progress Summary table.

---

## Rules

- **One `[~]` task at a time.** Don't mark multiple tasks in-progress. Finish or block one before starting another.
- **Always read before write.** Check the backlog before making changes to catch edits the user may have made.
- **Don't delete tasks.** Move completed tasks to the Completed (Recent) section. Blockers and decisions stay in place until resolved.
- **Don't edit task descriptions** unless fixing a typo. If a task needs to change scope, add a note rather than rewriting it.
- **Reference specs.** Many tasks reference docs like ARCHITECTURE.md, FEATURES.md, QUEUE_SYNC.md, ADR_*.md, or DESIGN_DECISIONS.md. Read the relevant doc before starting work on those tasks.
- **Keep it clean.** No extra whitespace, no broken markdown, no orphaned status markers.

---

## Reporting Status

When the user asks "what's the status" or "where are we", give them:

1. The Progress Summary table (already at top of BACKLOG.md — just read it)
2. What's in progress (`[~]`)
3. What's blocked (`[!]`) and why
4. What needs their input (`[?]`)
5. What you'd pick next

Keep it brief. They don't want a novel.
