---
name: shutdown
description: FeedDeck session shutdown and progress save. Use this skill whenever the user says "let's wrap up", "save progress", "we're done for now", "shutting down", "call it a day", "that's enough for today", "save and quit", or any variation of ending a work session. Also trigger when a major milestone is completed (all tasks in a backlog section marked done) or when the user signals they're about to close the session. This skill ensures nothing is lost between sessions.
---

# FeedDeck Shutdown Sequence

Run this when the session is ending. The goal: leave the project in a clean state with a clear trail so the next session picks up without friction.

**This skill works in both Claude Code and Cowork.** Steps marked [Code only] should be skipped in Cowork sessions.

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

## Step 6: Save Memory Session Log (ALWAYS DO THIS)

Write a session log to the memory vault. This is the primary bridge between sessions across both Code and Cowork.

1. Copy the template from `_memory/sessions/_TEMPLATE.md`
2. Save as `_memory/sessions/YYYY-MM-DD-HH.md` (use 24hr hour of session start)
3. Fill in EVERY section. Be specific in the Resumption Point — the next session reads this cold.

**Paths:**
- In Claude Code: `../_memory/sessions/`
- In Cowork: `_memory/sessions/` in the mounted workspace folder

### Also check if any of these need updating:

- **Made a decision?** Create a note in `_memory/decisions/YYYY-MM-DD-short-name.md` with YAML frontmatter (`type: decision`, `project: feeddeck`, `date`, `status: active|implemented|superseded`) and explain what, why, what it replaced, files affected.
- **Hit a non-obvious bug?** Add it to `_memory/errors/feeddeck-known-issues.md` with symptom, cause, fix, and files involved.
- **Project state changed?** Update `_memory/projects/feeddeck/_PROJECT.md` if the "Current State" section is now stale.

Use `[[wikilink]]` syntax for cross-references between memory notes.

## Step 7: TLDR to User

Give the user a short, punchy recap. Three to five sentences max. Cover:
- What got done
- What's next
- Anything they need to think about before next session
- Confirm that the memory session log was saved

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
- If there are uncommitted git changes, mention them to the user and ask if they want to commit.
