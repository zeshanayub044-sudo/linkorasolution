# Automatic Codex publishing

Main is the only permanent branch. The owner's standing authorization is recorded in the root AGENTS.md. A completed task includes implementation, testing, committing, pushing, a validated PR merge, branch deletion, local synchronization and Pages deployment verification.

## Requirements and operation

Git, Node.js and PowerShell 7 are needed for the helper. There is no npm installation or application build step. GitHub CLI can run the whole PR lifecycle when installed and authenticated; no token is stored in the repository.

Codex can instead use its authorized GitHub connection with the helper's AgentManaged mode. The helper emits a branch/head SHA after committing and pushing. Codex must create/update the PR, inspect checks on that head, review the diff, merge with the expected head SHA and call Complete with the verified merge commit. The handoff is an intermediate step, never a completed task.

The Publish mode requires an explicit list of reviewed files, a real commit message, a PR title and a description file. The description file should be outside the checkout, or intentionally included as documentation. Unstaged unrelated work is not silently discarded. If the working tree is not clean after committing, the helper stops before pushing.

The helper stores a publishing manifest only inside .git. Complete requires the recorded branch/head, a merge commit on origin/main, and either ancestry or an identical combined patch for a squash merge. Only then does it delete the exact task ref with a lease to protect concurrent updates, return to main and pull with --ff-only.

The optional GitHub Allow auto-merge setting is not a dependency: Codex or authenticated gh performs the verified merge itself. The helper does not use admin bypasses, force-push main or automatically merge arbitrary external PRs.

## Validation and hosting

Run `node scripts/validate.mjs`. It checks JavaScript and Apps Script syntax, local HTML links/anchors, conflict markers, unique migration timestamps, common credential patterns, whitespace and existing branding/attendance tests. Credential checks allow public Supabase anon keys, reject service-role JWTs and print only a filename/rule. Pattern checks cannot guarantee detection of every possible secret; review the diff as well.

PRs targeting main and pushes to main run the read-only **Repository validation** Actions job. It also parses the PowerShell helper. Publishing requires that job to succeed on the current head, even if branch protection is absent. Other required checks and reviews must also pass.

Existing GitHub Pages hosting remains in place. A merge into main triggers its managed build/deployment for linkorasolution.com. After merging, check the Pages run for the actual main commit and verify the critical public/admin routes. Pages does not deploy Supabase migrations, Edge Functions or Apps Script; those require separately authorized backend work.

## Failure handling

Keep the branch and manifest if checks, reviews, authentication, patch verification or production safety prevent completion. Report the precise blocker, fix it safely and resume. Never delete genuine unique work, conceal failed checks, or tell the owner to perform routine Git commands when the connected tools can do them.
