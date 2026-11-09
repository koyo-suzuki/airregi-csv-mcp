import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { defaultDataDirectory, dataDirectory, validDate, monthChunks, safeName, inspectCsv, validateRange } from '../src/core.mjs';

test('OSごとの保存先', () => {
  assert.equal(defaultDataDirectory({ home: '/Users/a', platform: 'darwin', env: {} }), path.join('/Users/a', 'Library', 'Application Support', 'airregi-csv-mcp'));
  assert.equal(defaultDataDirectory({ home: 'C:\\Users\\a', platform: 'win32', env: { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' } }), path.join('C:\\Users\\a\\AppData\\Roaming', 'airregi-csv-mcp'));
  assert.equal(defaultDataDirectory({ home: 'C:\\Users\\a', platform: 'win32', env: {} }), path.join('C:\\Users\\a', 'AppData', 'Roaming', 'airregi-csv-mcp'));
  assert.equal(defaultDataDirectory({ home: '/home/a', platform: 'linux', env: {} }), path.join('/home/a', '.local', 'share', 'airregi-csv-mcp'));
  assert.equal(dataDirectory({ AIRREGI_APP_DATA: path.resolve('x') }), path.resolve('x'));
});

test('日付の検証', () => {
  assert.ok(validDate('2024-02-29'));
  assert.ok(!validDate('2023-02-29'));
  assert.ok(!validDate('2023-02-30'));
  assert.ok(!validDate('2023-2-1'));
  assert.ok(!validDate(undefined));
  const now = Date.parse('2026-01-10T00:00:00Z');
  assert.throws(() => validateRange('2026-01-05', '2026-01-01', now), { code: 'INVALID_RANGE' });
  assert.throws(() => validateRange('2026-01-01', '2026-01-11', now), { code: 'FUTURE_RANGE' });
});

test('月ごとに分ける', () => {
  const now = Date.parse('2026-12-31T00:00:00Z');
  assert.deepEqual(monthChunks('2026-01-15', '2026-03-02', now), [
    { from: '2026-01-15', to: '2026-01-31' }, { from: '2026-02-01', to: '2026-02-28' }, { from: '2026-03-01', to: '2026-03-02' },
  ]);
  assert.deepEqual(monthChunks('2026-05-03', '2026-05-03', now), [{ from: '2026-05-03', to: '2026-05-03' }]);
});

test('ファイル名に使えない文字を置き換える', () => {
  assert.equal(safeName('A/店:1'), 'A_店_1');
  assert.equal(safeName('..\\a'), '__a');
  assert.equal(safeName('店舗. '), '店舗');
  assert.equal(safeName(''), 'CSV');
});

test('CSVの行数を数える（UTF-8とCP932）', () => {
  assert.deepEqual(inspectCsv(Buffer.from('\uFEFF商品,金額\r\nA,100\r\nB,200\r\n')), { header: '商品,金額', dataLines: 2 });
  assert.deepEqual(inspectCsv(Buffer.from('商品,金額\r\n')), { header: '商品,金額', dataLines: 0 });
  const sjis = Buffer.from([0x82, 0xa0, 0x2c, 0x82, 0xa2, 0x0d, 0x0a, 0x31, 0x2c, 0x32, 0x0d, 0x0a]);
  assert.deepEqual(inspectCsv(sjis), { header: 'あ,い', dataLines: 1 });
});
