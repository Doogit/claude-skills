export const meta = {
  name: 'dynamic-workflows-codex',
  description: 'Point at a plan file: Opus decomposes it into dependency waves, Codex (gpt-5.6-terra @ medium) workers implement each task in its own git worktree via `codex exec`, Sonnet verifies + adversarially reviews each diff, Sonnet synthesizes a per-task merge report. Never auto-merges; never forks.',
  whenToUse: 'You have a plan/spec file and want Codex models to do the implementation while Opus orchestrates and Sonnet verifies. Launch the orchestrator session from inside (or point args.plan at a file in) the target git repo — the repo root is auto-discovered from the plan location.',
  phases: [
    { title: 'Decompose', detail: 'Opus reads the plan -> schema-validated tasks[] + dependency waves + repo root' },
    { title: 'Implement', detail: 'Codex workers (gpt-5.6-terra @ medium) implement each task, one worktree per task' },
    { title: 'Verify', detail: 'Sonnet runs acceptance checks + adversarial diff review; one repair round on failure' },
    { title: 'Synthesize', detail: 'Sonnet merges results into per-task status + suggested merge order (no auto-merge)' },
  ],
}

// ---- Schemas -------------------------------------------------------------

const TASKS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['repo_root', 'tasks', 'waves'],
  properties: {
    repo_root: { type: 'string' },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'files', 'acceptance', 'deps', 'size', 'prompt'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          acceptance: { type: 'string' },
          deps: { type: 'array', items: { type: 'string' } },
          size: { type: 'string', enum: ['s', 'm', 'l'] },
          prompt: { type: 'string' },
          verifyCmd: { type: 'string' },
        },
      },
    },
    // Each wave is a list of task ids that are safe to run concurrently
    // (no shared files, no intra-wave deps).
    waves: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
  },
}

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'exit_code', 'files_touched', 'stderr_tail'],
  properties: {
    status: { type: 'string', enum: ['ok', 'failed'] },
    codex_output: { type: ['object', 'null'], additionalProperties: true },
    exit_code: { type: 'integer' },
    files_touched: { type: 'array', items: { type: 'string' } },
    stderr_tail: { type: 'string' },
    error: { type: ['string', 'null'] },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pass', 'severity', 'findings'],
  properties: {
    pass: { type: 'boolean' },
    severity: { type: 'string', enum: ['none', 'low', 'medium', 'high', 'critical'] },
    diffstat: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['summary'],
        properties: {
          summary: { type: 'string' },
          file: { type: ['string', 'null'] },
          suggestion: { type: ['string', 'null'] },
        },
      },
    },
  },
}

const COMMIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['committed'],
  properties: {
    committed: { type: 'boolean' },
    sha: { type: ['string', 'null'] },
    diffstat: { type: ['string', 'null'] },
  },
}

const ROOT_SCAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['leaked', 'dirty', 'porcelain'],
  properties: {
    leaked: { type: 'boolean' },
    dirty: { type: 'array', items: { type: 'string' } },
    porcelain: { type: 'string' },
  },
}

const REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tasks', 'suggested_merge_order', 'notes'],
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'status', 'branch', 'worktree'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          status: { type: 'string' },
          branch: { type: 'string' },
          worktree: { type: 'string' },
          commit_sha: { type: ['string', 'null'] },
          files_touched: { type: 'array', items: { type: 'string' } },
          unresolved_findings: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    suggested_merge_order: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}

// ---- Helpers -------------------------------------------------------------

const WORKER_MODEL = 'gpt-5.6-terra' // single knob — passed to the worker via the task contract
const WORKER_EFFORT = 'medium'
const REPAIR_EFFORT = 'high' // repair rounds escalate effort — the model already failed once at WORKER_EFFORT

function worktreeOf(repoRoot, id) {
  return repoRoot + '/.worktrees/dwc-' + id
}

function workerPrompt(t, repoRoot, findings, base) {
  const contract = {
    task_id: t.id,
    repo_root: repoRoot,
    worktree_path: worktreeOf(repoRoot, t.id),
    branch: 'dwc/' + t.id,
    base: base || 'HEAD',
    sandbox: 'workspace-write',
    model: WORKER_MODEL,
    effort: findings ? REPAIR_EFFORT : WORKER_EFFORT,
    instructions:
      t.prompt +
      '\n\nFiles in scope: ' + (t.files || []).join(', ') +
      '\nAcceptance: ' + t.acceptance,
    findings: findings || '',
  }
  return (
    'CODEX WORKER TASK. Follow your agent instructions exactly. Do not reason about the ' +
    'design; hand this to Codex via `codex exec`. Task contract JSON:\n\n```json\n' +
    JSON.stringify(contract, null, 2) +
    '\n```\n' +
    (findings ? '\nThis is a REPAIR round — reuse the SAME worktree.\n' : '')
  )
}

// Authorization failures are returned to the caller for resolution, never retried here.
async function implement(t, repoRoot, phase, findings, base) {
  return await agent(workerPrompt(t, repoRoot, findings, base), {
    agentType: 'codex-worker',
    label: findings ? t.id + ':repair' : t.id,
    phase,
    schema: RESULT_SCHEMA,
  })
}

async function verify(t, repoRoot, impl) {
  const wt = worktreeOf(repoRoot, t.id)
  return await agent(
    'You are a strict, adversarial reviewer verifying ONE task in an isolated git worktree.\n' +
    'Worktree: ' + wt + '\n' +
    'Task: ' + t.title + '\n' +
    'Acceptance criteria: ' + t.acceptance + '\n' +
    (t.verifyCmd
      ? 'Acceptance command (run it from the worktree directory): ' + t.verifyCmd + '\n'
      : 'No acceptance command was given; verify by reading the diff against the criteria.\n') +
    'The implementation worker reported: ' +
    JSON.stringify({ status: impl.status, exit_code: impl.exit_code, files_touched: impl.files_touched }) +
    '\n\nDo ALL of:\n' +
    '1. FIRST stage all changes so NEW (untracked) files are visible: `git -C "' + wt + '" add -A`. ' +
    'Then run `git -C "' + wt + '" --no-pager diff --cached --stat` and `git -C "' + wt + '" --no-pager diff --cached` to see ALL changes INCLUDING new files. ' +
    'Staging does NOT commit — the worker intentionally left changes uncommitted, and the commit step re-stages anyway. ' +
    'A newly created file that appears in `git status` but not the plain (unstaged) diff is PRESENT, not missing.\n' +
    '2. ' + (t.verifyCmd
      ? 'Run the acceptance command from the worktree directory and record pass/fail (and the error if it fails). Note: the worktree does NOT have node_modules unless the plan installs them — if the command fails purely for missing deps, say so and judge acceptance from the diff instead.'
      : 'Judge whether the diff objectively satisfies the acceptance criteria.') + '\n' +
    '3. Adversarially review the diff for correctness bugs, missed criteria, and anything that would break in a real repo.\n' +
    '4. Guard against false-green: if the ONLY evidence of acceptance is a test (or grep) that asserts on a ' +
    'CONSTANT or exported config value rather than rendered/observed behavior, treat acceptance as NOT met ' +
    '(pass=false) and record a finding — a worker can satisfy the string without implementing the behavior.\n\n' +
    'Return: pass (true ONLY if acceptance is objectively met), severity, diffstat (the --stat output), ' +
    'and findings[] (each a concrete defect with file + suggestion). Be skeptical: if you cannot confirm acceptance, pass=false.',
    { label: 'verify:' + t.id, phase: 'Verify', model: 'sonnet', schema: VERDICT_SCHEMA }
  )
}

// Commit a passing task on its branch so the branch is diffable and PR-able.
// The worker deliberately leaves changes uncommitted; we commit only after a pass.
async function commitTask(t, repoRoot) {
  const wt = worktreeOf(repoRoot, t.id)
  return await agent(
    'Commit one passing task in its git worktree, then report. Do not push. Use only the ' +
    'exact git commands below (all with `-C`).\n' +
    'Worktree: ' + wt + '\nBranch: dwc/' + t.id + '\n\n' +
    'Steps:\n' +
    '1. Stage everything: git -C "' + wt + '" add -A\n' +
    '2. If nothing is staged (git -C "' + wt + '" diff --cached --quiet exits 0), return {committed:false, sha:null, diffstat:null}.\n' +
    '3. Otherwise commit with message exactly: dwc(' + t.id + '): ' + (t.title || t.id).replace(/\n/g, ' ') + '\n' +
    '   i.e. git -C "' + wt + '" commit -m "<that message>"\n' +
    '4. Return {committed:true, sha:<git -C "' + wt + '" rev-parse --short HEAD>, diffstat:<git -C "' + wt + '" show --stat --oneline HEAD>}.',
    { label: 'commit:' + t.id, phase: 'Verify', model: 'haiku', schema: COMMIT_SCHEMA }
  )
}

// Guarantee the SKILL.md §4 root-leak check instead of leaving it to the orchestrator's memory:
// Codex workers sometimes write a task's edits into the repo ROOT instead of their worktree and
// then fail to commit, so the branch looks empty while live code sits in root (dirtying main).
async function rootScan(repoRoot) {
  return await agent(
    'Inspect dirty paths in a git repo ROOT. Run exactly: git -C "' + repoRoot + '" status --porcelain\n' +
    'Ignore any path under .worktrees/ (those are the task worktrees, expected).\n' +
    'Return leaked=true if ANY other path is dirty (staged, unstaged, or untracked), dirty[] = those ' +
    'porcelain lines verbatim, and porcelain = the full raw output. leaked=false if root is otherwise clean.',
    { label: 'root-scan', phase: 'Synthesize', model: 'haiku', schema: ROOT_SCAN_SCHEMA }
  )
}

// One task end to end: implement -> verify -> (one repair round -> re-verify) -> commit on pass.
async function runTask(t, repoRoot, base) {
  const impl = await implement(t, repoRoot, 'Implement', null, base)
  if (!impl) return { task: t, impl: null, verdict: null, status: 'no-result' }

  if (impl.status !== 'ok') return { task: t, impl, verdict: null, status: 'fail' }

  let verdict = await verify(t, repoRoot, impl)
  let finalImpl = impl

  if (verdict && verdict.pass === false) {
    const findingsText = (verdict.findings || [])
      .map(f => '- ' + f.summary + (f.file ? ' [' + f.file + ']' : '') + (f.suggestion ? ' -> ' + f.suggestion : ''))
      .join('\n')
    const repair = await implement(t, repoRoot, 'Verify', findingsText || 'Address the reviewer findings.', base)
    if (!repair || repair.status !== 'ok') return { task: t, impl: repair, verdict, status: 'fail' }
    if (repair) {
      finalImpl = repair
      verdict = await verify(t, repoRoot, repair)
    }
  }

  const status = verdict && verdict.pass ? 'pass' : 'fail'
  let commit = null
  if (status === 'pass') commit = await commitTask(t, repoRoot)

  return { task: t, impl: finalImpl, verdict, status, commit }
}

// ---- Body ----------------------------------------------------------------

phase('Decompose')

const planPath = args && args.plan
if (!planPath) throw new Error('args.plan (path to the plan file) is required')

const decomp = await agent(
  'You are decomposing an implementation plan into independent tasks for coding ' +
  'workers (Codex) that have ZERO conversation context and cannot see this plan or chat.\n\n' +
  'Steps:\n' +
  '1. Read the plan file at: ' + planPath + ' (use the Read tool; read any repo files it references).\n' +
  '2. Determine the target repo root by running: git -C "<directory containing the plan>" rev-parse --show-toplevel. ' +
  'Return it as repo_root (absolute path).\n' +
  '3. If the plan carries Dynamic-Workflows dispatch structure — "> Dispatch:" headers per unit, a YAML ' +
  'units: manifest, or named gates — take it VERBATIM: files[] = the unit\'s owns write-set, waves from the ' +
  'stated fan-out/isolation, verifyCmd from the named gate\'s commands. Do not re-derive what the plan ' +
  'already states.\n' +
  '4. Emit tasks[]. Each task: stable kebab id (e.g. t1-add-fn), title, files[] it will create/modify ' +
  '(repo-relative), acceptance (objective + verifiable), deps (ids of prerequisite tasks), size (s/m/l), ' +
  'and prompt (FULLY self-contained: name exact files, the exact change, and the acceptance — the worker ' +
  'cannot see the plan or this conversation). Include verifyCmd wherever acceptance is checkable by command. ' +
  'Worktrees have no node_modules of their own, but Node resolves node_modules by walking UP — so if the ' +
  'repo root has node_modules (check for <repo_root>/node_modules), prefer real checks that run from the ' +
  'worktree via --no-install, e.g. "npx --no-install tsc --noEmit -p tsconfig.json" or ' +
  '"npx --no-install vitest run <test file>". Only fall back to dep-free file/grep checks when the root has ' +
  'no deps. A task with no verifyCmd gets judged from the diff alone, which cannot catch type/test failures. ' +
  'Split any task you would rate size "l" into a CHAIN of smaller (s/m) dependent tasks in successive waves. ' +
  'A task that needs a prerequisite task\'s CODE must list exactly that one task in deps — its worktree is ' +
  'based on the dep\'s branch, so code-dependencies must form linear chains (one dep max), never diamonds. ' +
  'Ordering-only deps (no code needed) may still be multiple; those tasks base on HEAD.\n' +
  '5. Group tasks into waves (arrays of ids). Tasks in the SAME wave MUST NOT share any file and MUST NOT ' +
  'depend on each other; put dependents in later waves. Reject/split any two same-wave tasks that touch an ' +
  'overlapping file.\n\n' +
  'Return the structured object.',
  { label: 'decompose', phase: 'Decompose', model: 'opus', schema: TASKS_SCHEMA }
)

if (!decomp || !decomp.tasks || !decomp.tasks.length) {
  return { error: 'decomposition produced no tasks', decomp: decomp || null }
}

const repoRoot = (args && args.repo) || decomp.repo_root
if (!repoRoot) return { error: 'no repo_root discovered', decomp }

const byId = {}
decomp.tasks.forEach(t => { byId[t.id] = t })
let waves = (decomp.waves && decomp.waves.length) ? decomp.waves : [decomp.tasks.map(t => t.id)]

// Optional slice: keep only the first N task ids in wave order.
if (args && args.slice) {
  const flat = []
  for (const w of waves) for (const id of w) if (flat.length < args.slice) flat.push(id)
  const keep = new Set(flat)
  waves = waves.map(w => w.filter(id => keep.has(id))).filter(w => w.length)
  log('slice: running ' + flat.length + ' of ' + decomp.tasks.length + ' task(s)')
}

const totalTasks = waves.reduce((n, w) => n + w.length, 0)

// dryRun: stop after decomposition (no implementation).
if (args && args.dryRun) {
  return {
    dryRun: true,
    repo_root: repoRoot,
    plan: planPath,
    task_count: totalTasks,
    waves,
    tasks: decomp.tasks.filter(t => waves.some(w => w.includes(t.id))),
  }
}

// Implement + Verify, wave by wave (waves are sequential; tasks within a wave run concurrently).
const initialRoot = await rootScan(repoRoot)
if (!initialRoot || initialRoot.leaked !== false) {
  return { error: 'Target root must be clean before execution; preserve existing changes.', root_state: initialRoot }
}

phase('Implement')
const results = []
const statusById = {}
for (let wi = 0; wi < waves.length; wi++) {
  const waveTasks = waves[wi].map(id => byId[id]).filter(Boolean)
  if (!waveTasks.length) continue
  log('Wave ' + (wi + 1) + '/' + waves.length + ': ' + waveTasks.length + ' task(s)')
  // A single-dep task is a CHAIN link: base its worktree on the dep's committed branch so it
  // can build on that code. Skip it (don't burn a Codex run) if the chained dep didn't pass.
  // Multi-dep / no-dep tasks base on HEAD as before (ordering-only deps).
  const runnable = []
  for (const t of waveTasks) {
    const deps = t.deps || []
    const chainDep = deps.length === 1 ? deps[0] : null
    if (chainDep && statusById[chainDep] && statusById[chainDep] !== 'pass') {
      log('skipping ' + t.id + ' — chained dep ' + chainDep + ' did not pass')
      results.push({ task: t, impl: null, verdict: null, status: 'skipped-dep-failed', commit: null })
      statusById[t.id] = 'skipped-dep-failed'
      continue
    }
    const base = chainDep && statusById[chainDep] === 'pass' ? 'dwc/' + chainDep : 'HEAD'
    runnable.push({ t, base })
  }
  const waveResults = await parallel(runnable.map(({ t, base }) => () => runTask(t, repoRoot, base)))
  for (const r of waveResults.filter(Boolean)) {
    results.push(r)
    statusById[r.task.id] = r.status
  }
}

// Synthesize.
phase('Synthesize')

// Automated root-leak verdict (SKILL.md §4): fail loud instead of silently dirtying main.
const rootLeak = await rootScan(repoRoot)
if (rootLeak && rootLeak.leaked) {
  log('⚠ root-leak: ' + (rootLeak.dirty || []).length + ' dirty path(s) in repo root — recover per SKILL.md §4 before merging')
}

const digest = results.map(r => ({
  id: r.task.id,
  title: r.task.title,
  status: r.status,
  deps: r.task.deps || [],
  branch: 'dwc/' + r.task.id,
  worktree: worktreeOf(repoRoot, r.task.id),
  impl_status: r.impl ? r.impl.status : null,
  files_touched: r.impl ? (r.impl.files_touched || []) : [],
  committed: r.commit ? !!r.commit.committed : false,
  commit_sha: r.commit && r.commit.committed ? (r.commit.sha || null) : null,
  commit_diffstat: r.commit ? (r.commit.diffstat || '') : '',
  verdict: r.verdict ? { pass: r.verdict.pass, severity: r.verdict.severity, diffstat: r.verdict.diffstat || '', findings: r.verdict.findings || [] } : null,
}))

const report = await agent(
  'You are synthesizing the results of a multi-task Codex build. Do NOT merge anything.\n' +
  'Here are the per-task results (JSON):\n\n' + JSON.stringify(digest, null, 2) + '\n\n' +
  'Passing tasks were committed on their branch (see committed/commit_sha); failed tasks were left ' +
  'uncommitted for rework.\n' +
  'Produce a report object:\n' +
  '- tasks[]: id, title, status, branch, worktree, commit_sha (null if not committed), files_touched, ' +
  'unresolved_findings (summaries of any findings from a task whose final verdict is not pass).\n' +
  '- suggested_merge_order: task ids ordered so dependencies land before dependents; put failed/unverified ' +
  'tasks last and flag them in notes.\n' +
  '- notes: short prose — overall pass/fail counts, which tasks are committed vs need rework, which need ' +
  'human attention, and any cross-task risks.\n' +
  'Return the structured object.',
  { label: 'synthesize', phase: 'Synthesize', model: 'sonnet', schema: REPORT_SCHEMA }
)

// Compact return: keep the orchestrator's context flat regardless of plan size.
// Full per-agent detail (codex output, diffs, every finding) already lives in the run's
// journal.jsonl on disk — read it on demand instead of carrying it in the main thread.
const passCount = results.filter(r => r.status === 'pass').length
const rep = report || { tasks: [], suggested_merge_order: [], notes: '' }
const compactTasks = (rep.tasks || []).map(t => {
  const o = {
    id: t.id,
    status: t.status,
    branch: t.branch,
    commit_sha: t.commit_sha || null,
    files: (t.files_touched || []).length,
  }
  // Only surface findings for tasks that did NOT pass — those are the actionable ones.
  if (t.status !== 'pass' && t.unresolved_findings && t.unresolved_findings.length) {
    o.unresolved_findings = t.unresolved_findings
  }
  return o
})

const out = {
  plan: planPath,
  repo_root: repoRoot,
  task_count: totalTasks,
  pass_count: passCount,
  fail_count: totalTasks - passCount,
  tasks: compactTasks,
  suggested_merge_order: rep.suggested_merge_order || [],
  notes: rep.notes || '',
  root_leak: (rootLeak && rootLeak.leaked)
    ? { leaked: true, dirty: rootLeak.dirty || [] }
    : { leaked: false },
  detail: 'Full per-agent results (codex output, diffs, all findings) are in the run journal.jsonl — read on demand. Pass args.verbose:true to inline the full report + raw digest.',
}
// Opt-in escape hatch for debugging; off by default to keep the return small.
if (args && args.verbose) {
  out.report = rep
  out.raw = digest
}
return out
