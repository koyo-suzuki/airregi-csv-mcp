#!/usr/bin/env node
// エアレジのCSVを取得するコマンド。MCPサーバーと同じ処理を使う。
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { AppError, dataDirectory, publicError, todayInJapan } from './core.mjs';
import { AirregiBrowser } from './browser.mjs';
import { describeReports } from './reports.mjs';
import { planDownload, stamp } from './tools.mjs';

export const EXIT = { OK: 0, ERROR: 1, PARTIAL: 2, LOGIN_REQUIRED: 3, USAGE: 64 };

export const HELP = `使い方: airregi-csv <コマンド> [オプション]

コマンド:
  reports                 取得できる帳票の一覧
  stores                  店舗の一覧
  login                   Chrome でログイン画面を開き、ログインし終わるまで待つ
  download                CSVを取得する

download のオプション:
  --report <ID>           帳票のID（reports で確認）。必須
  --store <店舗名>        店舗。何回でも指定できる
  --all-stores            全店舗（--store の代わり）
  --last-month            先月の1日から月末まで
  --this-month            今月の1日から今日まで
  --month <YYYY-MM>       指定した月の1日から月末まで
  --from <YYYY-MM-DD>     開始日（--to と一緒に使う）
  --to <YYYY-MM-DD>       終了日
  --out <フォルダ>        保存先。省略するとデータフォルダの downloads の下

共通のオプション:
  --json                  結果をJSONで出す
  --headless              Chrome の画面を出さずに動かす（login では使えない）
  -h, --help              この説明を出す

終了コード:
  0 すべて取得  2 一部だけ取得  3 ログインが必要  1 そのほかの失敗  64 指定の誤り`;

const OPTIONS = {
  report: { type: 'string' }, store: { type: 'string', multiple: true }, 'all-stores': { type: 'boolean' },
  'last-month': { type: 'boolean' }, 'this-month': { type: 'boolean' }, month: { type: 'string' },
  from: { type: 'string' }, to: { type: 'string' }, out: { type: 'string' },
  json: { type: 'boolean' }, headless: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
};

function monthEnd(y, m) { return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); }
function pad(n) { return String(n).padStart(2, '0'); }

// 期間の指定（--last-month など）を、開始日と終了日にする。日付は日本時間で数える。
export function resolvePeriod(v, now = Date.now()) {
  const modes = ['last-month', 'this-month', 'month', 'from'].filter(k => v[k] !== undefined && v[k] !== false);
  if (modes.length !== 1) throw new AppError('USAGE', '期間は --last-month、--this-month、--month、--from/--to のどれか1つで指定してください。');
  const today = todayInJapan(now);
  const [ty, tm] = today.split('-').map(Number);
  if (v['last-month']) {
    const y = tm === 1 ? ty - 1 : ty, m = tm === 1 ? 12 : tm - 1;
    return { from: `${y}-${pad(m)}-01`, to: monthEnd(y, m) };
  }
  if (v['this-month']) return { from: `${ty}-${pad(tm)}-01`, to: today };
  if (v.month !== undefined) {
    const m = /^(\d{4})-(\d{2})$/.exec(v.month);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new AppError('USAGE', '--month は YYYY-MM の形で指定してください。');
    const from = `${m[1]}-${m[2]}-01`; const end = monthEnd(Number(m[1]), Number(m[2]));
    return { from, to: end > today && from <= today ? today : end };
  }
  if (v.to === undefined) throw new AppError('USAGE', '--from を使うときは --to も指定してください。');
  return { from: v.from, to: v.to };
}

const STATUS_LABEL = { downloaded: '取得', header_only: '見出しだけ', failed: '失敗', not_attempted: '未取得' };
const OVERALL_LABEL = { completed: 'すべて取得しました', partial: '一部だけ取得しました', failed: '取得できませんでした', cancelled: '中止しました' };

function exitFor(result) {
  if (result.results.some(r => r.error?.code === 'LOGIN_REQUIRED')) return EXIT.LOGIN_REQUIRED;
  return result.status === 'completed' ? EXIT.OK : result.status === 'partial' ? EXIT.PARTIAL : EXIT.ERROR;
}

function codeFor(e) {
  if (e?.code === 'USAGE') return EXIT.USAGE;
  if (e?.code === 'LOGIN_REQUIRED') return EXIT.LOGIN_REQUIRED;
  return EXIT.ERROR;
}

export async function run(argv, { browser, dataDir, stdout = process.stdout, stderr = process.stderr, now = () => Date.now(), signal } = {}) {
  const out = s => stdout.write(s + '\n'); const err = s => stderr.write(s + '\n');
  let parsed;
  try { parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true }); }
  catch (e) { err(e.message); err('airregi-csv --help で使い方を確認できます。'); return EXIT.USAGE; }
  const { values: v, positionals } = parsed;
  const command = positionals[0];
  if (v.help || !command || command === 'help') { out(HELP); return command || v.help ? EXIT.OK : EXIT.USAGE; }
  if (positionals.length > 1) { err(`余分な指定があります: ${positionals.slice(1).join(' ')}`); return EXIT.USAGE; }

  const print = (value, text) => { if (v.json) out(JSON.stringify(value, null, 2)); else out(text); };
  try {
    if (command === 'reports') {
      const reports = describeReports();
      print({ reports }, reports.map(r => `${r.id}\t${r.name}\t${r.description}`).join('\n'));
      return EXIT.OK;
    }
    if (command === 'stores') {
      const stores = await browser.listStores();
      print({ stores }, stores.join('\n'));
      return EXIT.OK;
    }
    if (command === 'login') {
      if (v.headless) throw new AppError('USAGE', 'login は画面が必要なので、--headless と一緒には使えません。');
      err('Chrome でエアレジのログイン画面を開きました。ログインし終わるまで待ちます（最長10分）。');
      const stores = await browser.loginAndWait({ signal });
      print({ status: 'logged_in', stores }, `ログインできました。店舗は ${stores.length} 件です。`);
      return EXIT.OK;
    }
    if (command === 'download') {
      if (!v.report) throw new AppError('USAGE', '--report で帳票を指定してください（reports で一覧を確認できます）。');
      if (v['all-stores'] && v.store) throw new AppError('USAGE', '--store と --all-stores は一緒に使えません。');
      if (!v['all-stores'] && !v.store) throw new AppError('USAGE', '--store で店舗を指定するか、--all-stores を付けてください。');
      const { from, to } = resolvePeriod(v, now());
      const output = v.out !== undefined ? path.resolve(v.out) : undefined;
      // 店舗一覧を読む前に、帳票と期間の指定を確かめる（店舗は仮の値で確かめる）。
      planDownload({ report: v.report, stores: v.store ?? ['_'], from, to, output_dir: output, now: now() });
      const stores = v['all-stores'] ? await browser.listStores() : v.store;
      const { report } = planDownload({ report: v.report, stores, from, to, output_dir: output, now: now() });
      const directory = output ?? path.join(dataDir, 'downloads', `${stamp(new Date(now()))}_${report.id}`);
      err(`${report.name}を取得します：${stores.length}店舗、${from} 〜 ${to}`);
      const result = await browser.downloadBatch({ report, stores, from, to, directory, signal,
        onProgress: p => {
          if (p.stage === 'downloading') err(`[${p.done + 1}/${p.total}] ${p.store} ${p.from} 〜 ${p.to}`);
          if (p.stage === 'failed') err(`  失敗：${p.store}：${p.error.message}`);
        } });
      const lines = result.results.map(r => `${STATUS_LABEL[r.status]}\t${r.store}\t${r.from} 〜 ${r.to}` + (r.error ? `\t${r.error.message}` : ''));
      print(result, [`${OVERALL_LABEL[result.status]}。保存先：${result.directory}`, ...lines].join('\n'));
      const code = exitFor(result);
      if (code === EXIT.LOGIN_REQUIRED) err('ログインが必要です。airregi-csv login でログインしてから、もう一度実行してください。');
      return code;
    }
    throw new AppError('USAGE', `コマンド「${command}」はありません。airregi-csv --help で使い方を確認できます。`);
  } catch (e) {
    const error = publicError(e);
    if (v.json) out(JSON.stringify({ error }, null, 2));
    err(error.message);
    if (error.code === 'LOGIN_REQUIRED' && command !== 'login') err('airregi-csv login でログインしてから、もう一度実行してください。');
    return codeFor(e);
  }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const dataDir = dataDirectory(env);
  const browser = new AirregiBrowser({ dataDir, headless: argv.includes('--headless') || env.AIRREGI_HEADLESS === '1' });
  const controller = new AbortController();
  let interrupted = false;
  process.on('SIGINT', () => {
    if (interrupted) process.exit(130);
    interrupted = true; controller.abort();
    process.stderr.write('中止しています。もう一度 Ctrl+C を押すと、すぐに終わります。\n');
  });
  try { return await run(argv, { browser, dataDir, signal: controller.signal }); }
  finally { await browser.close(); }
}

const self = fileURLToPath(import.meta.url);
const invoked = process.argv[1] && (() => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(self); } catch { return false; } })();
if (invoked) main().then(code => { process.exitCode = code; }, e => { process.stderr.write(`airregi-csv: ${e?.message ?? e}\n`); process.exitCode = 1; });
