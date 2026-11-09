// 帳票の定義。帳票を足すときは、ここに1つ追加する。
//
// verified: true  … ログインした画面で、URL・ボタン名・ファイル名を確かめ済み
// verified: false … 推測で書いた定義。画面で確かめて直すまで、取得が止まることがある
//
// 各項目:
//   url             帳票の画面（店舗を選んだあとに開く）
//   setPeriod(page, { from, to })
//                   期間を選んで表示する処理（任意）。ないときは、期間の入力欄のカレンダー
//                   （table.dates-table、「確定」「表示する」）で選ぶ（src/browser.mjs）
//   checkPeriod({ from, to }, now)
//                   月ごとに分けた期間を、この帳票で取得できるか確かめる（任意）。
//                   取得を始める前と、画面で期間を選ぶ前に呼ぶ
//   prepare(page)   期間を確定したあと、表示単位などを合わせる処理（任意）
//   sourcePeriod({ from, to })
//                   エアレジが付けるファイル名の期間（任意）。ないときは指定した期間
//   downloadMenu    ダウンロードボタンがメニューの中にあるとき、メニューを開くボタンの名前（任意）
//   downloadButton  CSVダウンロードボタンのアクセシブルな名前
//   sourcePrefix    エアレジが付けるファイル名の先頭（期間 YYYYMMDD-YYYYMMDD の前まで）
//   filePrefix      保存するときのファイル名の先頭

import { AppError, todayInJapan } from './core.mjs';

const MENU = 'https://airregi.jp/CLP/view/salesListByMenu/';
const DAILY = 'https://airregi.jp/CLP/view/salesList/';

function monthEnd(date) {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// 日別売上の画面は、期間をカレンダーではなく「集計対象・年・月」のプルダウンで選ぶ。
// 1回に選べるのは1か月なので、月の1日から月末（今月なら今日）までのときだけ受け付ける。
function checkWholeMonth({ from, to }, now = Date.now()) {
  const end = monthEnd(from);
  if (!from.endsWith('-01') || to.slice(0, 7) !== from.slice(0, 7) || (to !== end && to !== todayInJapan(now)))
    throw new AppError('PERIOD_UNSUPPORTED', 'この帳票は1か月単位でしか取得できません。開始日を月の1日、終了日を月末（今月なら今日）にしてください。');
}

async function selectMonth(page, period) {
  const { from } = period;
  const [year, month] = from.split('-');
  const unit = page.getByTitle('集計期間', { exact: true });
  const yearSelect = page.getByTitle('対象年度', { exact: true });
  const monthSelect = page.locator('.select-date-item select').nth(1);
  await unit.selectOption('D');
  await yearSelect.selectOption(year);
  await monthSelect.selectOption(month);
  await page.getByRole('button', { name: '表示する', exact: true }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: 7000 }).catch(() => {});
  if (await unit.inputValue() !== 'D' || await yearSelect.inputValue() !== year || await monthSelect.inputValue() !== month)
    throw new AppError('PERIOD_MISMATCH', '画面の期間が指定と一致しません。');
}

// 月単位の帳票のファイル名は、今月分でも「1日-月末」になる（例：今月1日〜今日を選んでも 20261101-20261130）。
function wholeMonth({ from }) { return from.replaceAll('-', '') + '-' + monthEnd(from).replaceAll('-', ''); }

// 会計明細CSVは「前月1日から当日分まで」しか出せないと画面に書かれている。
function previousMonthStart(now = Date.now()) {
  const [y, m] = todayInJapan(now).split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
}

async function selectDisplayUnit(page, label) {
  const radio = page.getByRole('radio', { name: label, exact: true });
  await radio.check();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: 7000 }).catch(() => {});
  if (!await radio.isChecked()) throw new AppError('DISPLAY_UNIT_MISMATCH', `表示単位「${label}」を選べませんでした。`);
}

async function requireAllCategories(page) {
  // 画面には並び順のプルダウンもあるため、「すべてのカテゴリー」を持つものを選ぶ。
  const combo = page.locator('select').filter({ has: page.locator('option', { hasText: 'すべてのカテゴリー' }) });
  if (await combo.count() !== 1) throw new AppError('CATEGORY_FILTER', 'カテゴリーのプルダウンが見つかりません。エアレジの画面が変わった可能性があります。');
  const label = (await combo.locator('option:checked').innerText()).trim();
  if (label !== 'すべてのカテゴリー') throw new AppError('CATEGORY_FILTER', '「すべてのカテゴリー」が選ばれていません。画面で選び直してください。');
}

export const REPORTS = [
  {
    id: 'variation_sales',
    name: 'バリエーション別売上',
    description: '商品のバリエーション（サイズ・種類など）ごとの売上。',
    verified: true,
    url: MENU,
    async prepare(page) { await selectDisplayUnit(page, 'バリエーション単位で表示'); await requireAllCategories(page); },
    downloadButton: 'バリエーション単位の売上(CSV)をダウンロードする',
    sourcePrefix: 'バリエーション別売上_',
    filePrefix: 'バリエーション別売上',
  },
  {
    id: 'product_sales',
    name: '商品別売上',
    description: '商品ごとの売上。',
    verified: true,
    // バリエーション別売上と同じ画面。表示単位を「商品単位で表示」にする。
    url: MENU,
    async prepare(page) { await selectDisplayUnit(page, '商品単位で表示'); await requireAllCategories(page); },
    downloadButton: '商品単位の売上(CSV)をダウンロードする',
    sourcePrefix: '商品別売上_',
    filePrefix: '商品別売上',
  },
  {
    id: 'daily_sales',
    name: '日別売上',
    description: '日ごとの売上（売上集計）。1か月単位で取得します。',
    verified: true,
    url: DAILY,
    // 期間はカレンダーではなく「集計対象：日別」「年」「月」のプルダウンで選ぶ。
    checkPeriod: checkWholeMonth,
    setPeriod: selectMonth,
    sourcePeriod: wholeMonth,
    downloadMenu: 'CSVデータをダウンロードする',
    downloadButton: '売上集計',
    sourcePrefix: '売上集計_',
    filePrefix: '日別売上',
  },
  {
    id: 'transaction_details',
    name: '会計明細',
    description: '会計ごとの明細。1か月単位で、前月1日以降の分だけ取得できます。',
    verified: true,
    // 会計明細CSVは、取引履歴ではなく日別売上の画面の「CSVデータをダウンロードする」から出す。
    // 取引履歴の画面のCSVは「入出金履歴」「ジャーナル履歴」で、会計明細ではない。
    url: DAILY,
    checkPeriod(period, now = Date.now()) {
      if (period.from < previousMonthStart(now))
        throw new AppError('PERIOD_UNSUPPORTED', '会計明細CSVは、前月1日から今日までの分しか取得できません（エアレジの制限）。');
      checkWholeMonth(period, now);
    },
    setPeriod: selectMonth,
    sourcePeriod: wholeMonth,
    downloadMenu: 'CSVデータをダウンロードする',
    downloadButton: '会計明細',
    sourcePrefix: '会計明細_',
    filePrefix: '会計明細',
  },
];

export function getReport(id) {
  const report = REPORTS.find(r => r.id === id);
  if (!report) throw new AppError('UNKNOWN_REPORT', `帳票「${id}」はありません。list_reports で一覧を確認してください。`);
  return report;
}

export function describeReports() {
  return REPORTS.map(({ id, name, description, verified }) => ({ id, name, description, verified }));
}
