const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../workflows/dynamic-workflows-codex.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
new AsyncFunction(source.replace('export const meta', 'const meta'));
const taskFunction = source.slice(source.indexOf('async function runTask('), source.indexOf('// ---- Body'));
async function check(results, reviews, expected, calls) {
  let implCalls = 0, reviewCalls = 0, commits = 0;
  const fn = new Function('implement', 'verify', 'commitTask', taskFunction + '; return runTask;')(
    async () => { implCalls++; return results.shift(); },
    async () => { reviewCalls++; return reviews.shift(); },
    async () => { commits++; return { committed: true }; }
  );
  const result = await fn({ id: 'test' }, '/fixture', 'HEAD');
  assert.equal(result.status, expected);
  assert.deepEqual([implCalls, reviewCalls, commits], calls);
}
(async () => {
  await check([{status:'failed', error:'permission denied'}], [], 'fail', [1,0,0]);
  await check([{status:'ok'}, {status:'failed', error:'permission denied'}], [{pass:false}], 'fail', [2,1,0]);
  await check([{status:'ok'}], [{pass:true}], 'pass', [1,1,1]);
  await check([{status:'ok'}, {status:'ok'}], [{pass:false}, {pass:true}], 'pass', [2,2,1]);
  console.log('Workflow parses; failures stop; passing and repair paths PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
