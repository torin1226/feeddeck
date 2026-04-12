---
name: startup
description: FeedDeck session startup checklist. Use this skill at the beginning of EVERY new session, whenever the user says "let's get started", "start up", "boot up", "where were we", "what's the status", "pick up where we left off", or any variation of resuming work on the project. Also trigger when Claude detects this is the first message in a new session and the user wants to work on FeedDeck. Run this before doing ANY other work.
---

# FeedDeck Startup Checklist

Run this checklist at the start of every work session. Complete each step in order before starting any feature work. The goal is to establish context, ensure a clean environment, and pick the right task.

**This skill works in both Claude Code and Cowork.** Steps marked [Code only] should be skipped in Cowork sessions.

## Step 0: Load Memory Vault (ALWAYS DO THIS FIRST)

The project uses a persistent Obsidian memory vault. Read these files in order before doing anything else:

1. Read `_memory/_INDEX.md` — understand the memory system structure
2. Read `_memory/_GLOBAL.md` — Torin's preferences, hardware, communication style
3. Read `_memory/projects/feeddeck/_PROJECT.md` — project architecture, current state, stack
4. Find the most recent file in `_memory/sessions/` and read it — picks up where last session left off
5. Check `_memory/errors/feeddeck-known-issues.md` if you're about to work on something that's failed before

**Paths:**
- In Claude Code: `../_memory/` (relative to feeddeck/)
- In Cowork: `_memory/` in the mounted workspace folder

Do NOT skip these reads. They contain context that doesn't fit in CLAUDE.md and bridge the gap between sessions.

## Step 1: Review Last Session

Read the update log and latest memory session log to understand what happened last time.

```
Read: BACKLOG.md (check the Completed section for recent entries)
Read: UPDATE_LOG.md (read the most recent entry)
```

Cross-reference with the session log from Step 0. The session log has the resumption point — that's the most specific "start here" instruction from the previous session.

Summarize to the user in 2-3 sentences: what was accomplished last session, what was in progress, and any open questions or blockers that carried over.

## Step 2: Health Check Before Launch [Code only]

Check the codebase for issues that may have appeared since last session. Run these checks and report results:

```bash
# Check for syntax/lint errors
cd feeddeck && npx eslint src/ --quiet 2>&1 | head -30

# Check that the project builds cleanly
npm run build 2>&1 | tail -20

# Check for any uncommitted changes or conflicts
git status
git diff --stat HEAD~1
```

If errors are found:
1. Report them clearly to the user
2. Offer to fix trivial issues (lint, missing imports) immediately
3. For non-trivial issues, note them and ask the user if they want to fix now or defer

## Step 3: Start Services [Code only]

Launch the dev server and any other services needed to access the app:

```bash
# Start the dev server (Vite + Express backend)
cd feeddeck && npm run dev &

# Wait for server to be ready, then report the URLs
# Local: http://localhost:3000
# Network: http://<local-ip>:3000 (for mobile testing)
```

Confirm to the user:
- Dev server is running
- Local URL is accessible
- Network URL for mobile testing (if relevant)

## Step 4: Runtime Error Check [Code only]

After services are running, check for runtime issues:

```bash
# Check server logs for errors
# Look for yt-dlp issues, database errors, port conflicts

# Verify key endpoints respond
curl -s http://localhost:3000/api/health | head -5
curl -s http://localhost:3000/api/homepage?mode=nsfw | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{len(d.get(\"categories\",{}))} categories loaded')" 2>/dev/null || echo "Homepage API not responding"
```

Report any issues found.

## Step 5: Fix Errors [Code only]

If Steps 2 or 4 found errors:
1. Fix them now (for anything that takes < 5 minutes)
2. For bigger issues, add them to the Discovered Tasks section of BACKLOG.md
3. Tell the user what was fixed and what was deferred

## Step 6: Review Backlog

Read BACKLOG.md and give the user a status report:

1. Any tasks marked `[~]` (in-progress) from last session
2. Any tasks marked `[!]` (blocked) and why
3. Any tasks marked `[?]` (needs user decision)
4. How many tasks remain in the current phase
5. What the next task should be based on priority rules

Keep this brief. No need to list every task.

## Step 7: Suggest Next Actions

Based on the backlog review, propose 1-3 things to work on this session. Consider:

- In-progress tasks that need finishing
- Blockers that can now be resolved
- The next task in priority order
- Any quick wins that would build momentum

Ask the user what they want to tackle. Don't start work until they confirm.

---

## Output Format

Present the startup checklist results as a compact status report, not a wall of text. Something like:

> **Last session:** [2-3 sentence summary]
> **Memory loaded:** [confirm memory vault was read, note any gaps]
> **Health check:** [pass/fail + details if fail] (Code only)
> **Services:** [running/issues] (Code only)
> **Backlog:** [X tasks remaining in current phase, Y blocked, Z need decisions]
> **Suggested next:** [1-3 options]
