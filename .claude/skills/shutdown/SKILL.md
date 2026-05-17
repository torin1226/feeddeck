---
name: shutdown
description: FeedDeck session shutdown and progress save. Use this skill whenever the user says "let's wrap up", "save progress", "we're done for now", "shutting down", "call it a day", "that's enough for today", "save and quit", or any variation of ending a work session. Also trigger when a major milestone is completed (all tasks in a backlog section marked done) or when the user signals they're about to close the session. This skill ensures nothing is lost between sessions.
---

# FeedDeck Shutdown Sequence

Run this when the session is ending. The goal: leave the project in a clean state with a clear trail so the next session picks up without friction.

**This skill works in both Claude Code and Cowork.** Steps marked [Code only] should be skipped in Cowork sessions.

## Step 0: Stale Manifest Sweep (ALWAYS DO THIS FIRST)

Before anything else, clean up any crashed parallel sessions. List `../_memory/sessions/active/` and ignore `_TEMPLATE.md`, `README.md`, `_stale/`. For each remaining file:

- Parse `session_id` and `started_at` from frontmatter
- If `started_at` is older than 2 hours AND there is no git activity matching that `session_id` since that time → move to `../_memory/sessions/active/_stale/`

This is belt-and-suspenders cleanup (startup does the same sweep). Without it, a crashed session leaves a phantom manifest that misleads future awareness checks.

## Step 1: Error & Tech Debt Scan [Code only]

Check for issues introduced during this session's work:

```bash
cd feeddeck

# Lint check
npx eslint src/ --quiet 2>&1 | head -30

# Build check
npm run build 2>&1 | tail -20

# Check for TODO/FIXME/HACK comments added this session
git diff HEAD --name-only | xargs grep -n "TODO\|FIXME\|HACK" 2>/dev/null || echo "No new TODOs"

# Check for console.log statements that should be removed
git diff HEAD --name-only | xargs grep -n "console\.log" 2>/dev/null || echo "No stray console.logs"
```

Note any errors, warnings, or tech debt found. These become candidates for backlog items.

## Step 2: Triage & Prioritize

For each issue found in Step 1 (or known from the session):
1. Is it a bug that will break things? Flag as urgent.
2. Is it tech debt that can wait? Note it for backlog.
3. Is it a quick fix (< 2 min)? Just fix it now.

For anything deferred, decide where it belongs in the backlog (which milestone, what priority relative to existing tasks).

## Step 3: Update Backlog

Open BACKLOG.md and make these updates:

1. Move any completed tasks from this session to the Completed section with today's date
2. Add any new discovered tasks or tech debt from Step 2 to the Discovered Tasks section
3. Update status markers: clear any `[~]` that's no longer in progress, add `[!]` for new blockers
4. Ensure the backlog accurately reflects the current state of the project

Save the file.

## Step 4: Recap Today's Progress

Build a summary of what happened this session:

- What tasks were completed (reference backlog task names)
- What was attempted but not finished (and why)
- What decisions were made
- What blockers or questions emerged
- Any architectural changes or significant code changes worth noting

## Step 5: Save to Update Log

Append an entry to UPDATE_LOG.md with this format:

```markdown
## [DATE] - Session Update

### Completed
- [List of completed tasks/features, with brief descriptions]

### In Progress
- [Tasks started but not finished, with current state]

### Decisions Made
- [Any design decisions, priority changes, or architectural choices]

### Issues & Blockers
- [Bugs found, tech debt noted, questions for next session]

### Key Files Changed
- [List of significant files added or modified]

### Next Session Should
- [1-3 specific things to start with next time]
```

## Step 6: Save Memory Session Log + Delete Active Manifest (ALWAYS DO THIS)

Write a session log to the memory vault, then delete your active manifest. **Order matters** — if the write fails or crashes, you do NOT want to delete the manifest, because the permanent log won't exist and the next session needs SOME record of what you did.

### 6a. Build the permanent log

1. Read your own active manifest at `../_memory/sessions/active/<session_id>.md`
2. Copy the template from `../_memory/sessions/_TEMPLATE.md`
3. Fill in EVERY section. **Incorporate the manifest's "Active Decisions" block into the permanent log's "Decisions Made" section** — do not lose those mid-session notes.
4. Be specific in the Resumption Point — the next session reads this cold.

### 6b. Write the permanent log

Save as `../_memory/sessions/YYYY-MM-DD-HH.md` (use 24hr hour of session start). If a file already exists for that hour (a parallel session also ran during this hour), suffix with `-b`, `-c`, etc.

### 6c. Verify, then delete the manifest

1. **Verify** the permanent log exists and is non-empty (`Test-Path` + size check).
2. **Only if step 1 succeeds**, delete the active manifest at `../_memory/sessions/active/<session_id>.md`.
3. If step 1 fails: HALT shutdown. Surface the error to Torin. Do NOT delete the manifest — the next session needs it.

**Paths:**
- In Claude Code: `../_memory/sessions/` and `../_memory/sessions/active/`
- In Cowork: `_memory/sessions/` and `_memory/sessions/active/` in the mounted workspace folder

### Also check if any of these need updating:

- **Made a decision?** Create a note in `_memory/decisions/YYYY-MM-DD-short-name.md` with YAML frontmatter (`type: decision`, `project: feeddeck`, `date`, `status: active|implemented|superseded`) and explain what, why, what it replaced, files affected.
- **Hit a non-obvious bug?** Add it to `_memory/errors/feeddeck-known-issues.md` with symptom, cause, fix, and files involved.
- **Project state changed?** Update `_memory/projects/feeddeck/_PROJECT.md` if the "Current State" section is now stale.

Use `[[wikilink]]` syntax for cross-references between memory notes.

## Step 7: Working Tree Hygiene (NON-NEGOTIABLE)

Run `git -C feeddeck status`. If the working tree has uncommitted changes, the session cannot end without resolving every modified file. Sort the modified files into two buckets first.

### Bucket A: files YOU modified this session (via Edit or Write tool calls)

You authored these. Choose one:

1. **Commit in coherent groups** on the current branch (preferred). One logical change per commit. If a group has no clear story, that's a signal you don't understand it well enough to commit it. Stash instead.
2. **`git -C feeddeck stash push -m "session-end-YYYY-MM-DD-<short-context>" -- <files>`** for genuine work-in-progress that can't form a coherent commit yet.

Do not skip this. Do not "leave it for next session." The drift recurrence catalog hit #11 on 2026-05-07 specifically because earlier shutdown flows used soft "ask if they want to commit" language. This rule is not negotiable for Bucket A.

### Bucket B: files modified by a parallel session (you did NOT author)

Do NOT auto-stash. A parallel session may still be actively editing these files; stashing would yank their work mid-flight, which is a different kind of drift than the one F2 was designed to prevent.

**Primary signal: active manifests.** Re-list `../_memory/sessions/active/*.md` (excluding your own). For each Bucket B file, check whether any other manifest names it under "Claimed Resources" or "Current Focus":

- **If a manifest claims the file** → the parallel session is definitely active. Do NOT use the mtime heuristic. Surface to Torin: "Session `<id>` has claimed these files. Stash anyway, leave in place, or coordinate?" Wait for explicit instruction.
- **If no manifest claims the file** → fall back to mtime staleness check (F2 behavior, retained as backstop):

**Backup signal: file mtime.** On Windows PowerShell: `Get-Item feeddeck/<file> | Select-Object LastWriteTime`. On Linux/macOS: `stat -c %Y feeddeck/<file>`. Compare the most recent file's mtime to current time.

- **Most recent change within the last 30 minutes:** the parallel session is likely still active (just hasn't claimed the file yet). Do not stash. Surface the file list with last-modified times to the user. Ask explicitly: "These [N] files were last touched [Xm ago] by what looks like a parallel session. Is that session still active? If yes I'll leave them in place; if no I'll stash with label `parallel-session-YYYY-MM-DD-<context>`."
- **Most recent change older than 30 minutes:** the parallel session is paused. Stash with descriptive label: `git -C feeddeck stash push -m "parallel-session-YYYY-MM-DD-<context>" -- <files>`. Surface to the user what was stashed and how to recover (`git -C feeddeck stash pop`).

When in doubt, ask the user. Never delete or commit parallel-session work.

## Step 8: TLDR to User

Give the user a short, punchy recap. Three to five sentences max. Cover:
- What got done
- What's next
- Anything they need to think about before next session
- Confirm that the memory session log was saved
- Confirm the active manifest was deleted (`active/<session_id>.md` no longer exists)
- Confirm working tree is clean (clean commit OR stash with label) before saying goodbye

---

## Trigger: Major Milestone Completion

If this skill triggers because a milestone was completed (not just end-of-day), also include:

- A milestone completion note in the update log
- A brief retrospective: what went well, what was harder than expected
- Confirmation of what the next milestone is and its first tasks

---

## Important Notes

- Always save BOTH UPDATE_LOG.md AND a memory session log before ending. The update log is the detailed record; the session log is the quick-resume context.
- Don't leave any `[~]` (in-progress) tasks in the backlog unless work genuinely needs to continue. Either complete them or revert to `[ ]`.
- If the dev server is still running, note it but don't kill it (user may want it up).
