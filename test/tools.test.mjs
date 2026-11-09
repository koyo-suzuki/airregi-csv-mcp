import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createTools } from '../src/tools.mjs';
import { REPORTS } from '../src/reports.mjs';

function fake() {
  const calls = [];
  let release;
  const gate = new Promise(r => { release = r; });
  const browser = {
    busy: false, stores: ['A'], isOpen: () => false,
    downloadBatch(args) {
      calls.push(args); this.busy = true;
      return gate.then(() => { this.busy = false; return { status: args.signal.aborted ? 'cancelled' : 'completed', directory: args.directory, results: [{ store: 'A', from: args.from, to: args.to, status: 'downloaded' }] }; });
    },
  };
  return { browser, calls, release };
}

const dataDir = path.resolve('data-test');
const now = () => new Date('2026-01-02T03:04:05Z');

test('帳票の一覧', () => {
  const tools = createTools({ browser: fake().browser, dataDir });
  const { reports } = tools.list_reports();
  assert.deepEqual(reports.map(r => r.id), REPORTS.map(r => r.id));
  assert.ok(reports.every(r => typeof r.verified === 'boolean' && r.name));
  assert.ok(reports.find(r => r.id === 'variation_sales').verified);
});

test('取得を始めて、終わったら結果が見える', async () => {
  const f = fake();
  const tools = createTools({ browser: f.browser, dataDir, now });
  const started = tools.start_download({ report: 'variation_sales', stores: ['A'], from: '2025-01-01', to: '2025-02-10' });
  assert.equal(started.status, 'running');
  assert.equal(started.progress.total, 2);
  assert.equal(started.directory, path.join(dataDir, 'downloads', '20260102-120405_variation_sales'));
  assert.deepEqual(tools.status().runningJobs, [started.job_id]);
  assert.throws(() => tools.start_download({ report: 'variation_sales', stores: ['A'], from: '2025-01-01', to: '2025-01-31' }), { code: 'BUSY' });
  f.release();
  await tools._jobs.get(started.job_id).promise;
  const done = tools.get_download({ job_id: started.job_id });
  assert.equal(done.status, 'completed');
  assert.equal(done.results.length, 1);
  assert.ok(done.finishedAt);
  assert.ok(!('controller' in done));
});

test('中止', async () => {
  const f = fake();
  const tools = createTools({ browser: f.browser, dataDir, now });
  const { job_id } = tools.start_download({ report: 'daily_sales', stores: ['A'], from: '2025-01-01', to: '2025-01-31' });
  assert.equal(tools.cancel_download({ job_id }).status, 'cancelling');
  f.release();
  await tools._jobs.get(job_id).promise;
  assert.equal(tools.get_download({ job_id }).status, 'cancelled');
});

test('取得中にブラウザが例外を出したら failed', async () => {
  const browser = { busy: false, stores: [], isOpen: () => false, downloadBatch: async () => { throw new Error('boom'); } };
  const tools = createTools({ browser, dataDir, now });
  const { job_id } = tools.start_download({ report: 'daily_sales', stores: ['A'], from: '2025-01-01', to: '2025-01-31' });
  await tools._jobs.get(job_id).promise;
  const job = tools.get_download({ job_id });
  assert.equal(job.status, 'failed');
  assert.equal(job.error.code, 'INTERNAL');
});

test('入力の検証', () => {
  const tools = createTools({ browser: fake().browser, dataDir, now });
  assert.throws(() => tools.start_download({ report: 'nope', stores: ['A'], from: '2025-01-01', to: '2025-01-31' }), { code: 'UNKNOWN_REPORT' });
  assert.throws(() => tools.start_download({ report: 'daily_sales', stores: [], from: '2025-01-01', to: '2025-01-31' }), { code: 'INVALID_STORES' });
  assert.throws(() => tools.start_download({ report: 'daily_sales', stores: ['A', 'A'], from: '2025-01-01', to: '2025-01-31' }), { code: 'INVALID_STORES' });
  assert.throws(() => tools.start_download({ report: 'daily_sales', stores: ['A'], from: '2025-02-01', to: '2025-01-31' }), { code: 'INVALID_RANGE' });
  assert.throws(() => tools.start_download({ report: 'daily_sales', stores: ['A'], from: '2025-01-01', to: '2025-01-31', output_dir: 'relative' }), { code: 'INVALID_OUTPUT_DIR' });
  assert.throws(() => tools.get_download({ job_id: 'x' }), { code: 'UNKNOWN_JOB' });
  assert.equal(tools._jobs.size, 0);
});

test('月単位の帳票で月の途中から始まる期間は、取得を始める前に断る', () => {
  const tools = createTools({ browser: fake().browser, dataDir, now });
  assert.throws(() => tools.start_download({ report: 'daily_sales', stores: ['A'], from: '2025-01-15', to: '2025-02-28' }), { code: 'PERIOD_UNSUPPORTED' });
  assert.throws(() => tools.start_download({ report: 'transaction_details', stores: ['A'], from: '2025-10-01', to: '2025-10-31' }), { code: 'PERIOD_UNSUPPORTED' });
  assert.equal(tools._jobs.size, 0);
  const ok = tools.start_download({ report: 'transaction_details', stores: ['A'], from: '2025-12-01', to: '2026-01-02' });
  assert.equal(ok.progress.total, 2);
});
