import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run, resolvePeriod, EXIT } from '../src/cli.mjs';
import { AppError } from '../src/core.mjs';

const NOW = Date.parse('2026-11-08T03:00:00Z'); // 日本時間 2026-11-08 12:00
const dataDir = path.resolve('data-test');

function sink() { let s = ''; return { write: x => { s += x; }, get text() { return s; } }; }

function fakeBrowser({ stores = ['A店', 'B店'], result, listError } = {}) {
  const calls = [];
  return {
    calls,
    async listStores() { calls.push(['listStores']); if (listError) throw listError; return stores; },
    async loginAndWait() { calls.push(['login']); return stores; },
    async downloadBatch(args) {
      calls.push(['download', args]);
      args.onProgress({ stage: 'downloading', store: args.stores[0], from: args.from, to: args.to, done: 0, total: 1 });
      return result ?? { status: 'completed', directory: args.directory, results: args.stores.map(s => ({ store: s, from: args.from, to: args.to, status: 'downloaded', file: 'x.csv' })) };
    },
  };
}

async function cli(argv, opts = {}) {
  const stdout = sink(), stderr = sink();
  const browser = opts.browser ?? fakeBrowser();
  const code = await run(argv, { browser, dataDir, stdout, stderr, now: () => NOW });
  return { code, out: stdout.text, err: stderr.text, browser };
}

test('期間の指定', () => {
  assert.deepEqual(resolvePeriod({ 'last-month': true }, NOW), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(resolvePeriod({ 'last-month': true }, Date.parse('2026-01-05T03:00:00Z')), { from: '2025-12-01', to: '2025-12-31' });
  assert.deepEqual(resolvePeriod({ 'this-month': true }, NOW), { from: '2026-11-01', to: '2026-11-08' });
  assert.deepEqual(resolvePeriod({ month: '2026-02' }, NOW), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(resolvePeriod({ month: '2026-11' }, NOW), { from: '2026-11-01', to: '2026-11-08' });
  assert.deepEqual(resolvePeriod({ from: '2026-01-03', to: '2026-02-04' }, NOW), { from: '2026-01-03', to: '2026-02-04' });
  assert.throws(() => resolvePeriod({}, NOW), { code: 'USAGE' });
  assert.throws(() => resolvePeriod({ 'last-month': true, month: '2026-01' }, NOW), { code: 'USAGE' });
  assert.throws(() => resolvePeriod({ month: '2026-13' }, NOW), { code: 'USAGE' });
  assert.throws(() => resolvePeriod({ from: '2026-01-01' }, NOW), { code: 'USAGE' });
});

test('help と、指定の誤り', async () => {
  assert.equal((await cli(['--help'])).code, EXIT.OK);
  assert.equal((await cli([])).code, EXIT.USAGE);
  assert.equal((await cli(['nope'])).code, EXIT.USAGE);
  assert.equal((await cli(['download', '--bogus'])).code, EXIT.USAGE);
  assert.equal((await cli(['download', '--all-stores', '--last-month'])).code, EXIT.USAGE);
  assert.equal((await cli(['download', '--report', 'daily_sales', '--last-month'])).code, EXIT.USAGE);
  assert.equal((await cli(['download', '--report', 'daily_sales', '--all-stores', '--store', 'A店', '--last-month'])).code, EXIT.USAGE);
  assert.equal((await cli(['login', '--headless'])).code, EXIT.USAGE);
});

test('reports を JSON で出す', async () => {
  const r = await cli(['reports', '--json']);
  assert.equal(r.code, EXIT.OK);
  assert.equal(JSON.parse(r.out).reports.length, 4);
});

test('全店舗の先月分を取得する', async () => {
  const r = await cli(['download', '--report', 'daily_sales', '--all-stores', '--last-month']);
  assert.equal(r.code, EXIT.OK);
  const [, args] = r.browser.calls.find(c => c[0] === 'download');
  assert.deepEqual(args.stores, ['A店', 'B店']);
  assert.equal(args.from, '2026-10-01'); assert.equal(args.to, '2026-10-31');
  assert.equal(args.report.id, 'daily_sales');
  assert.equal(args.directory, path.join(dataDir, 'downloads', '20261108-120000_daily_sales'));
  assert.match(r.out, /すべて取得しました/);
  assert.match(r.err, /\[1\/1\] A店/);
});

test('月単位の帳票で月の途中からの期間は、店舗一覧を読む前に断る', async () => {
  const r = await cli(['download', '--report', 'daily_sales', '--all-stores', '--from', '2026-10-15', '--to', '2026-10-31']);
  assert.equal(r.code, EXIT.ERROR);
  assert.match(r.err, /1か月単位/);
  assert.equal(r.browser.calls.length, 0);
});

test('一部だけ取れたら 2、ログイン切れなら 3', async () => {
  const partial = { status: 'partial', directory: 'd', results: [
    { store: 'A店', from: '2026-10-01', to: '2026-10-31', status: 'downloaded' },
    { store: 'B店', from: '2026-10-01', to: '2026-10-31', status: 'failed', error: { code: 'STORE_MISMATCH', message: 'x' } }] };
  assert.equal((await cli(['download', '--report', 'variation_sales', '--store', 'A店', '--store', 'B店', '--last-month'], { browser: fakeBrowser({ result: partial }) })).code, EXIT.PARTIAL);
  const login = { status: 'failed', directory: 'd', results: [{ store: 'A店', from: '2026-10-01', to: '2026-10-31', status: 'failed', error: { code: 'LOGIN_REQUIRED', message: 'x' } }] };
  const r = await cli(['download', '--report', 'variation_sales', '--store', 'A店', '--last-month'], { browser: fakeBrowser({ result: login }) });
  assert.equal(r.code, EXIT.LOGIN_REQUIRED);
  assert.match(r.err, /airregi-csv login/);
  const s = await cli(['stores'], { browser: fakeBrowser({ listError: new AppError('LOGIN_REQUIRED', 'ログインが必要です。') }) });
  assert.equal(s.code, EXIT.LOGIN_REQUIRED);
});

test('想定外のエラーは中身を出さない', async () => {
  const r = await cli(['stores', '--json'], { browser: fakeBrowser({ listError: new Error('secret detail') }) });
  assert.equal(r.code, EXIT.ERROR);
  assert.equal(JSON.parse(r.out).error.code, 'INTERNAL');
  assert.ok(!(r.out + r.err).includes('secret'));
});

test('コマンドとして起動できる（Chrome は起動しない）', () => {
  const cliPath = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [cliPath, 'reports'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /daily_sales/);
  const bad = spawnSync(process.execPath, [cliPath, 'download'], { encoding: 'utf8' });
  assert.equal(bad.status, EXIT.USAGE);
});
