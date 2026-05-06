# Daily Discovered Task Crusher

> Scheduled Claude Code task. Runs daily. Goal: pick the oldest unsolved discovered task from the backlog, fully fix it, and optionally tackle a second if the first was small. Ship clean code, update the backlog, commit.

---

## Identity & Context

You are maintaining FeedDeck, a personal media aggregator. Stack: React + Vite + Tailwind frontend, Express backend on port 3001, SQLite via `node:sqlite`, content sourced via yt-dlp (with Arc browser cookies), Puppeteer scraper, and Cobalt API. Two modes: `social` and `nsfw`.

**Your job today:** Fix discovered tasks. One minimum, two if the first was trivially small (< 15 minutes of work). Work in the order they were filed — oldest open `[ ]` item first.

---

## Session Protocol

### 1. Orient (always do first)

```
1. Read CLAUDE.md for current architecture and build state
2. Read ../_memory/_INDEX.md → ../_memory/_GLOBAL.md → ../_memory/projects/feeddeck/_PROJECT.md
3. Find and read the most recent file in ../_memory/sessions/
4. Read `../BACKLOG.md` (vault root — not `feeddeck/BACKLOG.md`, which is a redirect stub as of 2026-05-02) — focus on the "## Discovered Tasks" section
5. Run: git log --oneline -10
6. Run: git status
7. Run: npm run build 2>&1 | tail -20 (confirm build is clean before touching anything)
```

### 2. Pick the Task

Scan the `## Discovered Tasks` section of `../BACKLOG.md` (vault-root file; including the "Migrated from feeddeck/BACKLOG.md" and "Promoted from Design Reviews" subsections). Find the **first** `[ ]` item, reading top to bottom. That's your task.

**Skip rules:**
- Skip items marked `[?]` (need Torin's decision) or `[!]` (blocked)
- Skip items that say "defer", "investigate after", "no code action needed", or "usage time" — these are intentionally parked
- Skip items that require manual browser testing you can't automate
- If the first eligible task is a sizing/layout tweak (like "row too small"), check if adjacent items are also sizing tweaks and batch them as one task

### 3. Understand Before You Touch

For the selected task:
1. Read every file referenced in the task description
2. If the task mentions a plan file (`~/.claude/plans/...`), read it
3. Understand the surrounding code — don't just grep for the line number, read the full component/module
4. Check `../_memory/errors/feeddeck-known-issues.md` for related gotchas

### 4. Fix It

**Rules:**
- Make the smallest correct change. Don't refactor adjacent code unless it's part of the fix.
- If the task says "either X or Y", pick whichever is simpler and cleaner. Add a one-line comment if the choice isn't obvious.
- If deleting dead code, verify with grep first (`grep -r "ComponentName" src/ server/` — zero matches = safe to delete).
- Run `npm run build` after your change. If it breaks, fix it before moving on.
- Run `npx eslint src/ server/ --format compact 2>&1 | head -30` — zero new warnings.

### 5. Decide: Second Task?

After completing the first task, evaluate:
- Did it take less than ~15 minutes of actual work (a deletion, a one-liner, a config tweak)?
- Is the build still clean?
- Is there another eligible `[ ]` discovered task?

If all three: pick the next task and repeat steps 3-4.
If the first task was substantial (new endpoint, animation work, multi-file refactor): stop here.

**Hard cap: 2 tasks per session.** Even if both were tiny, stop at 2.

### 6. Update the Backlog

For each completed task:
1. Change `[ ]` to `[x]` and append today's date: `(YYYY-MM-DD)`
2. Add a brief note of what you did if the fix differed from what was described
3. Move the completed line to `## Completed (Recent)` at the bottom of `../BACKLOG.md`
4. If Completed (Recent) exceeds 10 items, move the oldest to `../BACKLOG-ARCHIVE.md`
5. Update the Progress Summary table's "Discovered Tasks" row (done count / total)

**Note:** Both `../BACKLOG.md` and `../BACKLOG-ARCHIVE.md` are at the vault root, NOT git-tracked. Edits land on disk only — there is no commit step for the backlog itself. The change history for backlog items lives in session logs.

### 7. Commit & Log

```bash
# Stage only the FEEDDECK source files you changed.
# (BACKLOG.md and BACKLOG-ARCHIVE.md live at the vault root and are not git-tracked.)
git add <changed feeddeck/* files>

# Commit with a clear message
git commit -m "fix(discovered): <short description of task 1>

<one-line summary of what changed and why>
[optional: + <short description of task 2>]

Backlog: discovered tasks X/Y complete"
```

Then write a session log to `../_memory/sessions/YYYY-MM-DD-discovered.md`:

```markdown
---
type: session
project: feeddeck
date: YYYY-MM-DD
surface: code (scheduled)
---

# Session Log — Discovered Task Crusher

## Tasks Completed
- **Task 1:** <name> — <what you did, 1-2 sentences>
- **Task 2:** <name if applicable> — <what you did>

## Files Changed
- <list of files>

## Build State
- Clean: yes/no
- ESLint: 0 new warnings / X total

## Next Eligible Task
- <name of the next [ ] discovered task in queue>

## Notes
- <anything surprising, adjacent issues noticed, context for future sessions>
```

### 8. If Something Goes Wrong

- **Build breaks after your change:** Revert with `git checkout -- <files>`, mark the task `[!]` with a note explaining why, pick the next task instead.
- **Task is bigger than described:** If you realize mid-fix that a task is actually L-sized (2+ hours), do whatever partial work makes sense, mark it `[~]` with a note on what's left, and stop. Don't rabbit-hole.
- **You discover a new issue:** Add it to Discovered Tasks with `[ ]` status and a note about what surfaced it. Don't fix it — that's tomorrow's job.

---

## What NOT to Do

- Don't touch milestone tasks (M3, M4, M5, etc.) — this session is discovered-tasks only
- Don't refactor beyond the scope of the fix
- Don't change the visual design (sizing, colors, layout) without the task explicitly calling for it
- Don't start the dev server — you're doing static analysis + build verification, not live testing
- Don't push to remote — Torin or the sync task handles that
