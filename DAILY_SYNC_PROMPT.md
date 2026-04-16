# Daily Git Sync & Push

> Scheduled Claude Code task. Runs daily. Goal: keep the local repo and GitHub in sync without ever losing work. Designed for a non-technical owner — only escalate decisions Torin can actually make.

---

## Context

- **Repo:** https://github.com/torin1226/feeddeck.git (remote: `origin`)
- **Local path:** `C:\Users\torin\Documents\Claude\area 51\feeddeck`
- **Branch strategy:** `master` is the stable baseline. Sprint branches (e.g. `sprint/2026-04-07`) are where active work happens. Multiple Claude sessions may push to the same sprint branch.
- **Owner:** Torin is a UX designer, not a developer. He can make decisions about what features matter, what the app should look like, and which direction to go. He cannot resolve merge conflicts by reading diffs. Don't ask him to.

---

## The Rules

1. **Never force push.** Ever. No `--force`, no `--force-with-lease`. If a push is rejected, figure out why.
2. **Never commit to master directly.** All work goes on sprint branches.
3. **Never auto-resolve merge conflicts.** If there's a conflict, YOU resolve it if it's trivial (whitespace, import order, non-overlapping changes). If it's a real design or logic conflict, pause and escalate with context Torin can act on.
4. **Never push a broken build.** Verify before pushing.
5. **If the git index looks corrupted** (mass staged deletions, phantom untracked files), fix the index first with `git checkout HEAD -- .` before doing anything else. Do NOT commit in a corrupted state.

---

## Session Steps

### 1. Pre-Flight Check

```bash
# What branch are we on?
git branch --show-current

# Is the index healthy? (should show only real changes, not hundreds of phantom deletions)
git status --short | head -30
git status --short | wc -l

# How far ahead/behind are we from remote?
git rev-list --left-right --count origin/$(git branch --show-current)...HEAD 2>/dev/null

# Any uncommitted work from other sessions?
git diff --stat
git diff --cached --stat
```

**Index corruption check:** If `git status` shows > 50 staged deletions with matching untracked files, the index is corrupted. Fix it:
```bash
git checkout HEAD -- .
```
This restores the index to match the last commit without touching your actual files. Verify with `git status` afterward — it should be clean or show only genuine changes.

### 2. Gather Uncommitted Work

Check if other Claude sessions left uncommitted changes (this happens when sessions end mid-task or crash):

```bash
git diff --stat
```

If there are uncommitted changes:

**Can you verify they're safe to commit?**
```bash
# Lint check
npx eslint src/ server/ 2>&1 | grep -c " error "

# Build check
npm run build 2>&1 | tail -5

# Server smoke test
timeout 5 node --experimental-detect-module server/index.js 2>&1 | tail -5
```

- If all three pass: stage and commit with message `sync: commit uncommitted work from prior session`
- If lint errors: run `npx eslint src/ server/ --fix`, re-check, then commit
- If build fails: DO NOT commit. Log the failure in the sync report (step 6) and move on to pushing what's already committed.

### 3. Fetch & Compare

```bash
git fetch origin

# Check if remote has commits we don't have locally
git log HEAD..origin/$(git branch --show-current) --oneline 2>/dev/null

# Check if we have commits remote doesn't have
git log origin/$(git branch --show-current)..HEAD --oneline 2>/dev/null
```

**Decision tree:**

| Local state | Remote state | Action |
|-------------|-------------|--------|
| Ahead, remote has nothing new | — | Push (step 4) |
| Behind, local has nothing new | — | Pull with fast-forward: `git pull --ff-only origin <branch>` |
| Both have new commits (diverged) | — | Rebase local on top of remote (step 3b) |
| Remote branch doesn't exist yet | — | Push with tracking: `git push -u origin <branch>` |

#### 3b. Handling Divergence (rebase)

When both local and remote have new commits, rebase local work on top of remote:

```bash
git rebase origin/$(git branch --show-current)
```

**If rebase succeeds cleanly:** Continue to step 4.

**If rebase hits conflicts:**

First, assess the conflict:
```bash
git diff --name-only --diff-filter=U
```

For EACH conflicted file, read the conflict markers and categorize:

- **Trivial** (whitespace, import reordering, both sides added non-overlapping code): Resolve it yourself. Pick the version that includes all changes, or merge both sides. Use your judgment.
- **Logic conflict** (two sessions changed the same function differently, a feature was partially reverted, competing implementations): Resolve it yourself if the intent of both changes is clear. The goal is always to keep both features working.
- **Design/UX conflict** (competing UI layouts, different component structures, contradictory user-facing behavior): Abort the rebase (`git rebase --abort`) and escalate to Torin (step 5).

After resolving:
```bash
git add <resolved files>
git rebase --continue
```

Verify the build still passes after rebase.

### 4. Push

```bash
# Final safety check
npm run build 2>&1 | tail -3

# Push
git push origin $(git branch --show-current)
```

If push is rejected (someone pushed while you were working):
```bash
git fetch origin
git rebase origin/$(git branch --show-current)
# Then try push again — max 2 retries
```

### 5. Escalation to Torin

**Only escalate when Torin's input actually matters.** He's a designer. He can tell you:
- Which version of a UI component looks/feels right
- Whether a feature should exist or be removed
- Priority when two features conflict
- Whether a visual change is intentional or a regression

**Never ask him:**
- To read a diff or resolve a merge conflict
- To choose between two code implementations
- To debug a build error
- Anything that requires understanding JavaScript

**Escalation format** (write to `SYNC_REVIEW_NEEDED.md` in the project root):

```markdown
# Sync Review Needed — [date]

## What happened
[1-2 sentences in plain English. No code jargon.]

## Your options
1. **[Option A name]:** [What Torin would see in the app if you pick this]
2. **[Option B name]:** [What Torin would see in the app if you pick this]

## My recommendation
[Which option and why, in terms of user experience, not code quality]

## What I need from you
[Exactly what to tell me. e.g., "Reply with A or B" or "Open the app and tell me which layout you prefer"]
```

### 6. Master Merge Check

Once per week (or when the sprint branch is > 50 commits ahead of master), evaluate whether it's time to merge to master:

```bash
git log master..HEAD --oneline | wc -l
```

If > 50 commits ahead:
- Run full build + lint + server startup test
- If everything passes, note in the sync report: "Sprint branch is N commits ahead of master. Recommend merging when Torin confirms the current state is stable."
- Do NOT merge to master without Torin's explicit go-ahead.

### 7. Sync Report

After every run, append to `SYNC_LOG.md` (create if it doesn't exist):

```markdown
### [date and time]
- **Branch:** [current branch]
- **Status:** [clean push / resolved conflicts / escalated / no changes]
- **Commits pushed:** [count, or "none"]
- **Uncommitted work found:** [yes/no, what was done about it]
- **Remote divergence:** [yes/no, how resolved]
- **Build status:** [pass/fail]
- **Action needed from Torin:** [none / see SYNC_REVIEW_NEEDED.md]
```

---

## Edge Cases

**Sprint branch doesn't exist on remote yet:**
```bash
git push -u origin $(git branch --show-current)
```

**You're on master somehow:**
Don't commit. Switch to the active sprint branch first:
```bash
git checkout sprint/2026-04-07  # or whatever the current sprint branch is
```

**New sprint branch needed** (old one merged or abandoned):
```bash
git checkout master
git pull --ff-only origin master
git checkout -b sprint/$(date +%Y-%m-%d)
git push -u origin sprint/$(date +%Y-%m-%d)
```

**Multiple sprint branches exist:**
Only work on the most recent one. Ignore older sprint branches unless Torin says otherwise.

**Remote repo is unreachable (network error):**
Log it and stop. Don't retry more than twice. The commits are safe locally — they'll push tomorrow.

---

## What "Done" Looks Like

1. Local and remote are in sync (no commits ahead or behind)
2. Build passes on the pushed code
3. No uncommitted changes left on disk (unless they're intentionally WIP)
4. SYNC_LOG.md updated
5. If escalation needed: SYNC_REVIEW_NEEDED.md written in plain English with clear options
