import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AirregiBrowser, periodLabel } from '../src/browser.mjs';
import { AppError } from '../src/core.mjs';
import { getReport } from '../src/reports.mjs';

async function tmp() { return fs.mkdtemp(path.join(os.tmpdir(), 'airregi-test-')); }

function fakeBrowser(dir, plan) {
  const b = new AirregiBrowser({ dataDir: dir });
  b.openReport = async (_r, store) => { if (plan.openFails?.[store]) throw plan.openFails[store]; };
  b.downloadOne = async (_r, store, chunk) => {
    const key = `${store}:${chunk.from}`;
    if (plan.fail?.[key]) throw plan.fail[key];
    return { file: path.join(dir, key), sourceFilename: 'x.csv', dataLines: plan.empty?.includes(key) ? 0 : 3 };
  };
  b.saveAuth = async () => {};
  return b;
}

test('期間のラベル', () => {
  assert.equal(periodLabel({ from: '2026-01-01', to: '2026-01-31' }), '20260101-20260131');
});

test('全部取れたら completed、ヘッダーだけは header_only', async () => {
  const dir = await tmp();
  const b = fakeBrowser(dir, { empty: ['B:2025-02-01'] });
  const r = await b.downloadBatch({ report: getReport('variation_sales'), stores: ['A', 'B'], from: '2025-01-10', to: '2025-02-05', directory: dir });
  assert.equal(r.status, 'completed');
  assert.equal(r.results.length, 4);
  assert.equal(r.results.find(x => x.store === 'B' && x.from === '2025-02-01').status, 'header_only');
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.status, 'completed');
});

test('ログイン切れで止まり、残りは not_attempted', async () => {
  const dir = await tmp();
  const b = fakeBrowser(dir, { fail: { 'A:2025-02-01': new AppError('LOGIN_REQUIRED', 'login') } });
  const r = await b.downloadBatch({ report: getReport('variation_sales'), stores: ['A', 'B'], from: '2025-01-01', to: '2025-02-28', directory: dir });
  assert.equal(r.status, 'partial');
  const by = s => r.results.filter(x => x.store === s).map(x => x.status).sort();
  assert.deepEqual(by('A'), ['downloaded', 'failed']);
  assert.deepEqual(by('B'), ['not_attempted', 'not_attempted']);
  assert.equal(b.busy, false);
});

test('店舗を開けなければ、その店舗の全期間を失敗にして次の店舗へ進む', async () => {
  const dir = await tmp();
  const b = fakeBrowser(dir, { openFails: { A: new AppError('UNKNOWN_STORE', 'x') } });
  const r = await b.downloadBatch({ report: getReport('variation_sales'), stores: ['A', 'B'], from: '2025-01-01', to: '2025-02-28', directory: dir });
  assert.equal(r.status, 'partial');
  assert.deepEqual(r.results.filter(x => x.store === 'A').map(x => [x.from, x.status, x.error.code]),
    [['2025-01-01', 'failed', 'UNKNOWN_STORE'], ['2025-02-01', 'failed', 'UNKNOWN_STORE']]);
  assert.ok(r.results.filter(x => x.store === 'B').every(x => x.status === 'downloaded'));
});

test('想定外のエラーは中身を出さずに BROWSER_CHANGED にする', async () => {
  const dir = await tmp();
  const b = fakeBrowser(dir, { fail: { 'A:2025-01-01': new Error('locator secret detail') } });
  const r = await b.downloadBatch({ report: getReport('variation_sales'), stores: ['A'], from: '2025-01-01', to: '2025-01-31', directory: dir });
  assert.equal(r.status, 'failed');
  assert.equal(r.results[0].error.code, 'BROWSER_CHANGED');
  assert.ok(!JSON.stringify(r).includes('secret'));
});

test('中止すると cancelled', async () => {
  const dir = await tmp();
  const controller = new AbortController(); controller.abort();
  const b = fakeBrowser(dir, {});
  const r = await b.downloadBatch({ report: getReport('variation_sales'), stores: ['A'], from: '2025-01-01', to: '2025-01-31', directory: dir, signal: controller.signal });
  assert.equal(r.status, 'cancelled');
  assert.equal(r.results[0].error.code, 'CANCELLED');
});

test('入力の検証', async () => {
  const b = fakeBrowser(await tmp(), {});
  const report = getReport('variation_sales');
  await assert.rejects(() => b.downloadBatch({ report, stores: ['A', 'A'], from: '2025-01-01', to: '2025-01-31' }), { code: 'INVALID_STORES' });
  await assert.rejects(() => b.downloadBatch({ report, stores: Array.from({ length: 11 }, (_, i) => 's' + i), from: '2024-01-01', to: '2024-12-31' }), { code: 'TOO_MANY' });
});

test('月単位の帳票は、月の1日から月末（今月なら今日）までだけ受け付ける', () => {
  const daily = getReport('daily_sales');
  const now = Date.parse('2026-03-10T00:00:00Z');
  assert.throws(() => daily.checkPeriod({ from: '2025-01-05', to: '2025-01-31' }, now), { code: 'PERIOD_UNSUPPORTED' });
  assert.throws(() => daily.checkPeriod({ from: '2025-01-01', to: '2025-01-30' }, now), { code: 'PERIOD_UNSUPPORTED' });
  daily.checkPeriod({ from: '2025-01-01', to: '2025-01-31' }, now);
  daily.checkPeriod({ from: '2026-03-01', to: '2026-03-10' }, now);
  const tx = getReport('transaction_details');
  assert.throws(() => tx.checkPeriod({ from: '2026-01-01', to: '2026-01-31' }, now), { code: 'PERIOD_UNSUPPORTED' });
  tx.checkPeriod({ from: '2026-02-01', to: '2026-02-28' }, now);
  assert.equal(getReport('variation_sales').checkPeriod, undefined);
});

test('月単位の帳票のファイル名の期間は、今月分でも月末まで', () => {
  for (const id of ['daily_sales', 'transaction_details'])
    assert.equal(getReport(id).sourcePeriod({ from: '2026-02-01', to: '2026-02-10' }), '20260201-20260228');
  assert.equal(getReport('variation_sales').sourcePeriod, undefined);
});

test('帳票が setPeriod を持っていればそれを使い、なければカレンダーで選ぶ', async () => {
  const b = new AirregiBrowser({ dataDir: await tmp() });
  const calls = [];
  b.page = { waitForLoadState: async () => {} };
  b.setCalendarPeriod = async (r, from, to) => calls.push(['calendar', r.id, from, to]);
  await b.setPeriod(getReport('product_sales'), '2025-01-01', '2025-01-31');
  const custom = { id: 'x', setPeriod: async (_page, p) => calls.push(['custom', p.from, p.to]), prepare: async () => calls.push(['prepare']) };
  await b.setPeriod(custom, '2025-02-01', '2025-02-28');
  assert.deepEqual(calls, [['calendar', 'product_sales', '2025-01-01', '2025-01-31'], ['custom', '2025-02-01', '2025-02-28'], ['prepare']]);
});

test('ログインが済むまで待ち、済んだら店舗一覧を返す', async () => {
  const b = new AirregiBrowser({ dataDir: await tmp() });
  let checks = 0;
  b.launch = async () => {}; b.navigate = async () => {}; b.settle = async () => {}; b.isOpen = () => true;
  b.page = { bringToFront: async () => {} };
  b.guard = async () => {
    checks++;
    if (checks === 1) throw new AppError('LOGIN_REQUIRED', 'login');
    if (checks === 2) throw new Error('Execution context was destroyed');
    if (checks === 3) throw new AppError('UNEXPECTED_PAGE', 'airid');
  };
  b.listStoresInternal = async () => ['A店'];
  assert.deepEqual(await b.loginAndWait({ intervalMs: 1 }), ['A店']);
  assert.equal(checks, 4);
  assert.equal(b.busy, false);
});

test('ログインを待つのは時間まで', async () => {
  const b = new AirregiBrowser({ dataDir: await tmp() });
  b.launch = async () => {}; b.navigate = async () => {}; b.settle = async () => {}; b.isOpen = () => true;
  b.page = { bringToFront: async () => {} };
  b.guard = async () => { throw new AppError('LOGIN_REQUIRED', 'login'); };
  await assert.rejects(() => b.loginAndWait({ timeoutMs: 5, intervalMs: 2 }), { code: 'LOGIN_TIMEOUT' });
  b.isOpen = () => false;
  await assert.rejects(() => b.loginAndWait({ intervalMs: 1 }), { code: 'BROWSER_CLOSED' });
});
