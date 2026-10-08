# Requires PowerShell 7, Invoke-Git and Node. GitHub CLI is optional in AgentManaged mode.
[CmdletBinding()]
param(
    [ValidateSet('Start', 'Publish', 'Complete')][string]$Mode = 'Publish',
    [string]$Task,
    [string]$Message,
    [string]$Title,
    [string]$BodyFile,
    [string[]]$Files,
    [switch]$AgentManaged,
    [string]$MergedCommit,
    [ValidateRange(30, 3600)][int]$MaxWaitSeconds = 1200
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = 'zeshanayub044-sudo/linkorasolution'
$root = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root

function Invoke-Git {
    $output = & git @args
    if ($LASTEXITCODE -ne 0) { throw "Invoke-Git failed: $($args[0])" }
    return $output
}
function Invoke-Gh {
    $output = & gh @args
    if ($LASTEXITCODE -ne 0) { throw "GitHub CLI failed: $($args[0])" }
    return $output
}
function Require-Clean {
    if (Invoke-Git status --porcelain) { throw 'Working tree must be clean. Preserve unfinished work first.' }
}
function Require-Branch([string]$branch) {
    if ($branch -eq 'main' -or $branch -notmatch '^(codex|feature|integration)/[a-z0-9][a-z0-9/-]*$') {
        throw 'Use a descriptive temporary task branch; publishing directly to main is disabled.'
    }
}
function Validate {
    & node (Join-Path $PSScriptRoot 'validate.mjs') --base origin/main
    if ($LASTEXITCODE -ne 0) { throw 'Repository validation failed; nothing will be published.' }
}
function Complete-Task([string]$mergeSha) {
    Require-Clean
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    Require-Branch $manifest.branch
    if ($mergeSha -notmatch '^[0-9a-f]{40}$') { throw 'Supply the verified full PR merge commit SHA.' }
    if ((Invoke-Git rev-parse HEAD) -ne $manifest.head) { throw 'Task head changed since publishing.' }
    if ((Invoke-Git branch --show-current) -ne $manifest.branch) { throw 'Checkout differs from published task branch.' }
    Invoke-Git fetch origin --prune | Out-Null
    & git merge-base --is-ancestor $mergeSha origin/main
    if ($LASTEXITCODE -ne 0) { throw 'Verified merge commit is not on remote main.' }
    & git merge-base --is-ancestor $manifest.head origin/main
    if ($LASTEXITCODE -ne 0) {
        $taskPatch = (Invoke-Git diff --binary $manifest.base $manifest.head | & git patch-id --stable)
        if ($LASTEXITCODE -ne 0) { throw 'Cannot calculate task patch.' }
        $mergedPatch = (Invoke-Git diff --binary "$mergeSha^" $mergeSha | & git patch-id --stable)
        if ($LASTEXITCODE -ne 0) { throw 'Cannot calculate merged patch.' }
        if (-not $taskPatch -or -not $mergedPatch -or
            ($taskPatch -split ' ')[0] -ne ($mergedPatch -split ' ')[0]) {
            throw 'Merged patch differs from published task. Preserve branch and investigate.'
        }
    }
    $remote = Invoke-Git ls-remote --heads origin "refs/heads/$($manifest.branch)"
    if ($remote) {
        if (($remote -split '\s+')[0] -ne $manifest.head) { throw 'Remote task branch changed; refusing deletion.' }
        # The lease guards a concurrent branch update; this deletes only the merged task ref.
        Invoke-Git push "--force-with-lease=refs/heads/$($manifest.branch):$($manifest.head)" origin ":refs/heads/$($manifest.branch)" | Out-Null
    }
    Invoke-Git switch main | Out-Null
    Invoke-Git pull --ff-only origin main | Out-Null
    Invoke-Git branch -D $manifest.branch | Out-Null # Squash patch was verified above.
    Invoke-Git fetch origin --prune | Out-Null
    Require-Clean
    Remove-Item -LiteralPath $manifestPath
    Write-Output "Published and cleaned: $(Invoke-Git rev-parse HEAD)"
}

$remoteUrl = Invoke-Git remote get-url origin
if ($remoteUrl -notmatch '^https://github\.com/zeshanayub044-sudo/linkorasolution(?:\.git)?$|^git@github\.com:zeshanayub044-sudo/linkorasolution(?:\.git)?$') {
    throw 'Unexpected origin; refusing to publish to another repository.'
}
$manifestPath = Join-Path (Invoke-Git rev-parse --absolute-git-dir) 'codex-publish.json'
if ($Mode -eq 'Start') {
    Require-Clean
    if ($Task -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$' -or $Task -in @('task', 'example', 'placeholder')) {
        throw 'Supply a real descriptive lowercase task name.'
    }
    if (Test-Path -LiteralPath $manifestPath) { throw 'Finish the previous published task first.' }
    Invoke-Git fetch origin --prune | Out-Null
    Invoke-Git switch main | Out-Null
    Invoke-Git pull --ff-only origin main | Out-Null
    Invoke-Git switch -c "codex/$Task" origin/main | Out-Null
    return
}
if ($Mode -eq 'Complete') {
    if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'No publishing manifest exists.' }
    Complete-Task $MergedCommit
    return
}
if (-not $Message -or -not $Title -or -not $Files -or -not $BodyFile -or
    -not (Test-Path -LiteralPath $BodyFile -PathType Leaf)) {
    throw 'Publish requires Message, Title, BodyFile and an explicit list of reviewed Files.'
}
if (-not $AgentManaged) {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        throw 'GitHub CLI is unavailable. Codex must use AgentManaged and finish with the connected GitHub tools.'
    }
    Invoke-Gh auth status | Out-Null
}
$branch = Invoke-Git branch --show-current
Require-Branch $branch
if (Test-Path -LiteralPath $manifestPath) { throw 'A publishing manifest already exists. Finish or investigate the previous task.' }
Invoke-Git fetch origin --prune | Out-Null
& git merge-base --is-ancestor origin/main HEAD
if ($LASTEXITCODE -ne 0) { throw 'Task is behind main. Integrate latest main safely and retest first.' }
if (Invoke-Git diff --name-only --diff-filter=U) { throw 'Unresolved merge conflicts.' }
if (Invoke-Git diff --cached --name-only) { throw 'Review and clear pre-existing staged changes before using Publish.' }
foreach ($file in $Files) {
    if ([IO.Path]::IsPathRooted($file) -or $file -match '(^|[\\/])\.\.([\\/]|$)|^(?:\.git|\.env)(?:[\\/.]|$)') {
        throw 'Files must be reviewed repository-relative paths; private and traversal paths are forbidden.'
    }
}
Validate
Invoke-Git add -- @Files | Out-Null
Invoke-Git -c core.whitespace=cr-at-eol diff --cached --check | Out-Null
# Revalidate staged content and remaining files before committing.
Validate
& git diff --cached --quiet
if ($LASTEXITCODE -eq 0) { throw 'No real changes staged; refusing an empty commit.' }
if ($LASTEXITCODE -ne 1) { throw 'Cannot inspect staged changes.' }
Invoke-Git commit -m $Message | Out-Null
Require-Clean # Never leave unrelated unstaged work behind.
$headSha = Invoke-Git rev-parse HEAD
$baseSha = Invoke-Git rev-parse origin/main
Invoke-Git push -u origin $branch | Out-Null
@{ repository = $repo; branch = $branch; head = $headSha; base = $baseSha } |
    ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8
if ($AgentManaged) {
    Write-Output (@{ repository = $repo; branch = $branch; head = $headSha;
        next = 'Create/update PR, verify current-head checks/reviews, merge with expected SHA, then run Complete.' } | ConvertTo-Json)
    return
}
$existing = @(Invoke-Gh pr list --repo $repo --head $branch --base main --state open --json number | ConvertFrom-Json)
if ($existing.Count -gt 1) { throw 'Multiple open task PRs; investigate.' }
if ($existing.Count -eq 0) {
    Invoke-Gh pr create --repo $repo --base main --head $branch --title $Title --body-file $BodyFile | Out-Null
} else {
    Invoke-Gh pr edit $existing[0].number --repo $repo --title $Title --body-file $BodyFile | Out-Null
}
$deadline = [DateTime]::UtcNow.AddSeconds($MaxWaitSeconds)
do {
    $pr = Invoke-Gh pr view $branch --repo $repo --json number,state,baseRefName,headRefOid,isCrossRepository,reviewDecision,mergeStateStatus,statusCheckRollup | ConvertFrom-Json
    if ($pr.state -ne 'OPEN' -or $pr.baseRefName -ne 'main' -or $pr.headRefOid -ne $headSha -or $pr.isCrossRepository) {
        throw 'PR target, ownership, state or head changed; refusing to merge.'
    }
    if ($pr.reviewDecision -eq 'CHANGES_REQUESTED' -or $pr.mergeStateStatus -eq 'DIRTY') { throw 'PR requires conflict/review resolution.' }
    $checks = @($pr.statusCheckRollup)
    $validation = @($checks | Where-Object { $_.PSObject.Properties['name'] -and $_.name -eq 'Repository validation' })
    $bad = @($checks | Where-Object {
        ($_.PSObject.Properties['conclusion'] -and $_.conclusion -in @('FAILURE','CANCELLED','TIMED_OUT','ACTION_REQUIRED','STARTUP_FAILURE')) -or
        ($_.PSObject.Properties['state'] -and $_.state -in @('FAILURE','ERROR'))
    })
    if ($bad.Count) { throw 'PR validation failed; branch preserved.' }
    $pending = @($checks | Where-Object {
        ($_.PSObject.Properties['status'] -and $_.status -ne 'COMPLETED') -or
        ($_.PSObject.Properties['state'] -and $_.state -in @('PENDING','EXPECTED'))
    })
    $ready = $validation.Count -gt 0 -and @($validation | Where-Object { $_.conclusion -ne 'SUCCESS' }).Count -eq 0 -and
        $pending.Count -eq 0 -and $pr.mergeStateStatus -eq 'CLEAN' -and $pr.reviewDecision -ne 'REVIEW_REQUIRED'
    if (-not $ready) {
        if ([DateTime]::UtcNow -ge $deadline) { throw 'Checks/reviews timed out; preserve task branch and continue when resolved.' }
        Start-Sleep -Seconds 10
    }
} until ($ready)
$query = 'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}pageInfo{hasNextPage}}}}}'
$threads = Invoke-Gh api graphql -f "query=$query" -f owner=zeshanayub044-sudo -f name=linkorasolution -F "number=$($pr.number)" | ConvertFrom-Json
if ($threads.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage -or
    @($threads.data.repository.pullRequest.reviewThreads.nodes | Where-Object { -not $_.isResolved }).Count) {
    throw 'Unresolved review threads; preserve task branch.'
}
Invoke-Gh pr merge $pr.number --repo $repo --squash --match-head-commit $headSha | Out-Null
$merged = Invoke-Gh pr view $pr.number --repo $repo --json state,mergeCommit | ConvertFrom-Json
if ($merged.state -ne 'MERGED') { throw 'PR was not merged.' }
Complete-Task $merged.mergeCommit.oid
