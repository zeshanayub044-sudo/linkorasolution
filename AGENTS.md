# Repository instructions

These instructions record the owner's standing authorization to complete routine Git/GitHub publishing for this repository. They apply unless the current user explicitly requests a different scope.

- `main` is the only permanent branch. Start every task with a clean checkout, fetch/prune, switch to main, and pull with `--ff-only`. Always begin from the latest `origin/main`; never develop on an old task branch.
- Use a temporary descriptive `codex/<actual-task>` branch for substantial changes. Never use placeholder names. Preserve unfinished work before switching or deleting anything.
- Implement the requested change in the existing architecture. Run `node scripts/validate.mjs` and applicable feature checks, inspect the complete diff, and check for secrets. Fix failures before publishing.
- Automatically stage reviewed files, commit a meaningful message, push, and create/update a same-repository PR targeting main. The owner has authorized these routine actions; do not ask them to run Git commands.
- Wait for the **Repository validation** check on the current PR head, and for every other required check/review. Review the final diff and any unresolved review requests. Never merge failed checks, stale heads, conflicts, or unreviewed unique code.
- Merge automatically using squash and an expected head SHA, without bypassing branch rules or using admin overrides. Do not depend on GitHub's optional auto-merge setting.
- Delete the completed remote and local task branch immediately after verifying the merge. Switch to main, pull `--ff-only`, fetch/prune, verify a clean tree, and confirm Pages deploys that main commit. Never leave completed branches behind.
- Never force-push main. Never commit credentials, passwords, database URLs containing credentials, service-role keys, or the Google Sheets webhook secret. Public Supabase anon/publishable keys are permitted.
- Production Supabase and Apps Script deployment are separate from Pages. Preserve deployed migration versions; do not rewrite/replay historical migrations or reset production. Follow the current task's backend deployment authorization.
- If validation, authentication, a migration ambiguity, or a real production risk blocks completion, preserve the work and report the exact blocker. Do not claim success.

## Publishing tools

Use PowerShell 7 and `scripts/codex-publish.ps1`:
1. `-Mode Start -Task <descriptive-name>` synchronizes main and creates a task branch.
2. `-Mode Publish -Message <message> -Title <title> -BodyFile <reviewed-description-file> -Files <reviewed-paths>` validates, commits, pushes, creates a PR, waits for checks, merges, deletes, and syncs.
3. When GitHub CLI is unavailable or unauthenticated, use `-AgentManaged` with Publish. It commits/pushes and emits the exact branch/head SHA. Use the connected GitHub tools to create the PR, inspect checks/reviews, and merge with that expected SHA. Then call `-Mode Complete -MergedCommit <verified-merge-sha>` to verify the patch, delete the branch, and synchronize main. Never extract credential-manager tokens.

Do not stop at the AgentManaged handoff: Codex must finish the connected GitHub lifecycle and verify deployment. No owner intervention is required for ordinary code publishing when the existing connections remain authorized.
