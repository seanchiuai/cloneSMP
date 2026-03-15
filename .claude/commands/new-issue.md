---
description: Setup a new worktree for a GitHub issue or feature
argument-hint: <issue-number, URL, or feature description>
---

# New Worktree

## Input

The user provides one of:
- A GitHub issue number or URL (e.g. `342` or `https://github.com/minds-ai-co/webapp/issues/342`)
- A feature description in quotes (e.g. `"add dark mode toggle"`)

Determine the mode from the input:
- **Issue mode**: input is a number or GitHub URL
- **Feature mode**: input is a text description

## Procedure

### 1. Get context

**Issue mode:**
```bash
gh issue view <NUMBER> --repo minds-ai-co/webapp --json number,title,body
```
Extract the issue number, title, and body. Derive a short kebab-case slug from the title (e.g. "Implement Web Plugin" → `web-plugin`).

**Feature mode:**
Derive a short kebab-case slug from the description (e.g. "add dark mode toggle" → `dark-mode-toggle`). There is no issue number — use `none` where a number is needed.

### 2. Ask about branch creation

Ask the user:
- **Create new branch** `<slug>` from `staging` (Recommended) — for new work
- **Use existing branch** — if the branch already exists (e.g. resuming work)

### 3. Create the worktree

```bash
WEBAPP="$HOME/Desktop/webapp"
WORKTREES="$WEBAPP/.worktrees"
```

If creating a new branch:
```bash
git -C "$WEBAPP" worktree add "$WORKTREES/<slug>" -b <slug> staging
```

If using an existing branch:
```bash
git -C "$WEBAPP" worktree add "$WORKTREES/<slug>" <slug>
```

### 4. Copy template files from `$WORKTREES/_template`

Copy the following into the new worktree:

```bash
# Copy .claude directory (commands, skills, settings — exclude junk)
rsync -a --exclude='.DS_Store' "$WORKTREES/_template/.claude/" "$WORKTREES/<slug>/.claude/"

# Copy CLAUDE.md template
cp "$WORKTREES/_template/CLAUDE.md.template" "$WORKTREES/<slug>/CLAUDE.md"

# Copy issue-tasks.md template into .claude/docs/
mkdir -p "$WORKTREES/<slug>/.claude/docs"
cp "$WORKTREES/_template/issue-tasks.md.template" "$WORKTREES/<slug>/.claude/docs/issue-tasks.md"
```

### 5. Populate templates with context

**Do NOT modify CLAUDE.md** — leave it as the raw template. The working session will fill it in.

**issue-context.md** — Create `.claude/docs/issue-context.md` with the issue context:
```markdown
---
issue: <NUMBER or none>
title: <TITLE or feature description>
branch: <slug>
created: <YYYY-MM-DD>
---

## Summary
<1-3 sentence summary from the issue body, or the feature description>

## Issue Body
<Full issue body (issue mode) or feature description (feature mode)>
```

**issue-tasks.md** — Replace frontmatter and extract tasks:
- `task` → issue title or feature description
- `issue` → issue number or `none`
- `branch` → the derived slug
- `created` → today's date
- **Issue mode**: Extract actionable tasks from the issue body into `## Items`
- **Feature mode**: Add default items: understand existing code → implement → test
- If no clear tasks in the issue, use defaults: understand → implement → test

### 6. Install dependencies

```bash
cd "$WORKTREES/<slug>" && npm install
```

### 7. Report completion

Tell the user:
- Worktree path
- Branch name
- What was populated
- Remind them to `cd` into the worktree and run `claude` to start working
