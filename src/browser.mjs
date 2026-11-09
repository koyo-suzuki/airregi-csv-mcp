import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError, safeName, monthChunks, writePrivate, ensurePrivateDir, inspectCsv } from './core.mjs';

const ENTRY = 'https://airregi.jp/CLP/view/salesList/';
const STORE_SELECT = 'https://airregi.jp/CLP/view/displayPlfSettingStoreSelect/?transitionUrl=' + encodeURIComponent(ENTRY);
const HEADER = 'li.cmn-hdr-store span.cmn-hdr-btn-text';
const STORES = 'a.storeList__list__innerBox__name';
const ALLOWED_HOSTS = ['airregi.jp', 'connect.airregi.jp'];
export const MAX_FILES = 120;

export function periodLabel({ from, to }) { return from.replaceAll('-', '') + '-' + to.replaceAll('-', ''); }

export class AirregiBrowser {
  constructor({ dataDir, headless = false, launcher = chromium } = {}) {
    this.dataDir = dataDir; this.authFile = path.join(dataDir, 'auth.json');
    this.headless = headless; this.launcher = launcher;
    this.client = null; this.context = null; this.page = null;
    this.busy = false; this.stores = []; this.currentStore = '';
  }

  async exclusive(fn) {
    if (this.busy) throw new AppError('BUSY', '別のエアレジ操作が実行中です。終わってからもう一度実行してください。');
    this.busy = true;
    try { return await fn(); } finally { this.busy = false; }
  }

  isOpen() { return Boolean(this.client?.isConnected() && this.page && !this.page.isClosed()); }

  async launch() {
    if (this.isOpen()) return;
    await this.close();
    let storageState;
    try { storageState = JSON.parse(await fs.readFile(this.authFile, 'utf8')); } catch {}
    try { this.client = await this.launcher.launch({ channel: 'chrome', headless: this.headless }); }
    catch { throw new AppError('CHROME_MISSING', 'Google Chrome を起動できません。Chrome が入っているか確認してください。'); }
    this.context = await this.client.newContext({ storageState, acceptDownloads: true, viewport: { width: 1380, height: 940 } });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(30000);
    this.page.on('dialog', d => d.dismiss().catch(() => {}));
  }

  async close() {
    await this.client?.close().catch(() => {});
    this.client = null; this.context = null; this.page = null;
  }

  async navigate(url) {
    try { await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); }
    catch { throw new AppError('NAVIGATION_TIMEOUT', 'エアレジの画面を読み込めませんでした。時間を置いて、未取得の店舗・期間だけもう一度実行してください。'); }
  }

  async settle() {
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForLoadState('networkidle', { timeout: 7000 }).catch(() => {});
  }

  async guard() {
    const u = new URL(this.page.url());
    if (u.protocol !== 'https:' || !ALLOWED_HOSTS.includes(u.hostname)) throw new AppError('UNEXPECTED_PAGE', 'エアレジ以外の画面へ移動したため止めました。');
    if (await this.page.locator('input[type=password]').count() || (!u.pathname.includes('/CLP/') && !u.pathname.includes('choose-store')))
      throw new AppError('LOGIN_REQUIRED', 'エアレジへのログインが必要です。open_login でログイン画面を開き、利用者が手動でログインしてから、もう一度実行してください。');
  }

  async saveAuth() { if (this.context) await writePrivate(this.authFile, await this.context.storageState()); }

  async openLogin() {
    return this.exclusive(async () => {
      await this.launch(); await this.navigate(ENTRY); await this.settle(); await this.page.bringToFront();
      return { status: 'opened', message: 'Chrome でエアレジのログイン画面を開きました。利用者がログインしたら list_stores で確認してください。' };
    });
  }

  // ログイン画面を開き、利用者が手でログインし終わるまで待つ。終わったら店舗一覧を返す（ログイン状態も保存する）。
  async loginAndWait({ timeoutMs = 10 * 60000, intervalMs = 2000, signal } = {}) {
    return this.exclusive(async () => {
      await this.launch(); await this.navigate(ENTRY); await this.settle(); await this.page.bringToFront();
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (signal?.aborted) throw new AppError('CANCELLED', 'ログインの待機を中止しました。');
        if (!this.isOpen()) throw new AppError('BROWSER_CLOSED', 'Chrome が閉じられました。もう一度実行してください。');
        try { await this.guard(); break; }
        catch (e) {
          // ログイン中はAirIDなど別の画面を通り、画面の切り替わりで確認自体が失敗することもある。
          // ログインが済むまでは止めずに待つ。
          if (e instanceof AppError && !['LOGIN_REQUIRED', 'UNEXPECTED_PAGE'].includes(e.code)) throw e;
        }
        if (Date.now() > deadline) throw new AppError('LOGIN_TIMEOUT', 'ログインが時間内に終わりませんでした。もう一度実行してください。');
        await new Promise(r => setTimeout(r, intervalMs));
      }
      return await this.listStoresInternal();
    });
  }

  async listStoresInternal() {
    await this.launch();
    await this.navigate(STORE_SELECT); await this.settle(); await this.guard();
    const links = this.page.locator(STORES);
    await links.first().waitFor({ timeout: 45000 });
    const names = (await links.allTextContents()).map(s => s.trim()).filter(Boolean);
    // 利用中の店舗は切り替え先のリンクに出ないため、画面の表示から加える。
    const currentLabel = this.page.getByText(/^利用中の店舗[：:]/);
    this.currentStore = await currentLabel.count() === 1 ? (await currentLabel.innerText()).replace(/^利用中の店舗[：:]\s*/, '').trim() : '';
    if (this.currentStore && !names.includes(this.currentStore)) names.unshift(this.currentStore);
    if (!names.length || new Set(names).size !== names.length) throw new AppError('STORE_LIST_CHANGED', '店舗一覧を一意に読み取れません。エアレジの画面を確認してください。');
    this.stores = names; await this.saveAuth();
    return names;
  }

  async listStores() { return this.exclusive(() => this.listStoresInternal()); }

  async verifyStore(store) {
    await this.guard();
    const header = this.page.locator(HEADER); await header.waitFor();
    if ((await header.innerText()).trim() !== store) throw new AppError('STORE_MISMATCH', '画面で選ばれている店舗が指定と一致しないため止めました。');
  }

  async openReport(report, store) {
    const stores = await this.listStoresInternal();
    if (!stores.includes(store)) throw new AppError('UNKNOWN_STORE', `店舗「${store}」は今の店舗一覧にありません。`);
    if (this.currentStore !== store) {
      const links = this.page.locator(STORES);
      const i = (await links.allTextContents()).findIndex(s => s.trim() === store);
      if (i < 0) throw new AppError('STORE_LIST_CHANGED', '指定した店舗の切り替え先が見つかりません。');
      await links.nth(i).click(); await this.settle();
    }
    await this.navigate(report.url); await this.settle(); await this.verifyStore(store);
  }

  async calendarMonth(year, month) {
    for (let attempt = 0; attempt < 121; attempt++) {
      const table = this.page.locator('table.dates-table');
      const label = (await table.locator('td.switch').innerText()).trim();
      const m = label.match(/^(\d{4})年(\d{1,2})月$/);
      if (!m) throw new AppError('CALENDAR_CHANGED', '期間を選ぶ画面の形が変わっています。');
      const current = Number(m[1]) * 12 + Number(m[2]); const target = year * 12 + month;
      if (current === target) return;
      await table.getByRole('cell', { name: target < current ? '«' : '»', exact: true }).click();
      await this.page.waitForFunction(prev => document.querySelector('table.dates-table td.switch')?.textContent?.trim() !== prev, label);
    }
    throw new AppError('CALENDAR_LIMIT', '期間の移動回数が上限に達しました。');
  }

  async calendarDay(date) {
    const [y, m, d] = date.split('-').map(Number); await this.calendarMonth(y, m);
    const cells = this.page.locator('table.dates-table td');
    const texts = (await cells.allTextContents()).map(s => s.trim());
    const first = texts.indexOf('1'); const index = first + d - 1;
    if (first < 0 || texts[index] !== String(d)) throw new AppError('CALENDAR_CHANGED', '指定した日付を画面で確かめられません。');
    await cells.nth(index).click();
  }

  // 帳票が setPeriod を持っていれば、それで期間を選ぶ。持っていなければカレンダーで選ぶ。
  async setPeriod(report, from, to) {
    if (report.checkPeriod) report.checkPeriod({ from, to });
    if (report.setPeriod) {
      await report.setPeriod(this.page, { from, to });
      await this.settle();
      if (report.prepare) await report.prepare(this.page);
      return;
    }
    await this.setCalendarPeriod(report, from, to);
  }

  // 期間の入力欄を押すと出るカレンダー（table.dates-table）で選び、「確定」「表示する」を押す。
  async setCalendarPeriod(report, from, to) {
    const input = this.page.getByRole('textbox').first();
    await input.click();
    await this.calendarDay(from); await this.calendarDay(to);
    await this.page.getByRole('button', { name: '確定', exact: true }).click();
    const expected = from.replaceAll('-', '/') + ' ~ ' + to.replaceAll('-', '/');
    if (await input.inputValue() !== expected) throw new AppError('PERIOD_MISMATCH', '画面の期間が指定と一致しません。');
    await this.page.getByRole('button', { name: '表示する', exact: true }).click(); await this.settle();
    if (report.prepare) await report.prepare(this.page);
    if (await input.inputValue() !== expected) throw new AppError('PERIOD_MISMATCH', '表示単位を切り替えたあと、期間が指定と一致しなくなりました。');
  }

  async downloadOne(report, store, chunk, directory) {
    await this.setPeriod(report, chunk.from, chunk.to); await this.verifyStore(store);
    // ダウンロードボタンがメニューの中にある帳票は、先にメニューを開く。
    if (report.downloadMenu) {
      const menu = this.page.getByRole('button', { name: report.downloadMenu, exact: true });
      if (await menu.count() !== 1) throw new AppError('DOWNLOAD_BUTTON_NOT_FOUND', `ダウンロードのメニュー「${report.downloadMenu}」が見つかりません。`);
      await menu.click();
    }
    const button = this.page.getByRole('button', { name: report.downloadButton, exact: true });
    // 表示単位を切り替えたあとなど、ボタンが少し遅れて出ることがあるので待つ。
    await button.first().waitFor({ timeout: 15000 }).catch(() => {});
    if (await button.count() !== 1) throw new AppError('DOWNLOAD_BUTTON_NOT_FOUND', `ダウンロードボタン「${report.downloadButton}」が見つかりません。` + (report.verified ? '' : 'この帳票の定義はまだ画面で確かめていません。'));
    const pending = this.page.waitForEvent('download', { timeout: 60000 }); pending.catch(() => {});
    await button.click();
    const download = await pending;
    if (await download.failure()) throw new AppError('DOWNLOAD_FAILED', 'エアレジからのダウンロードに失敗しました。');
    const period = periodLabel(chunk);
    // 月単位の帳票は、今月分でもファイル名の期間が月末までになる。
    const sourcePeriod = report.sourcePeriod ? report.sourcePeriod(chunk) : period;
    const sourceFilename = download.suggestedFilename();
    if (!sourceFilename.startsWith(report.sourcePrefix + sourcePeriod) || !sourceFilename.toLowerCase().endsWith('.csv'))
      throw new AppError('DOWNLOAD_NAME_MISMATCH', 'ダウンロードしたファイルの種類・期間が指定と一致しないため、保存しませんでした。', { sourceFilename, expectedPrefix: report.sourcePrefix + sourcePeriod });
    const file = path.join(directory, `${report.filePrefix}_${period}_${safeName(store)}.csv`);
    await download.saveAs(file); await fs.chmod(file, 0o600).catch(() => {});
    await this.verifyStore(store);
    const { dataLines } = inspectCsv(await fs.readFile(file));
    return { file, sourceFilename, dataLines };
  }

  async downloadBatch({ report, stores, from, to, directory, onProgress = () => {}, signal }) {
    if (!Array.isArray(stores) || !stores.length || new Set(stores).size !== stores.length) throw new AppError('INVALID_STORES', '店舗を1件以上、重複せずに指定してください。');
    const chunks = monthChunks(from, to);
    const total = stores.length * chunks.length;
    if (total > MAX_FILES) throw new AppError('TOO_MANY', `一度に取得できるのは ${MAX_FILES} ファイル（店舗数 × 月数）までです。`);
    return this.exclusive(async () => {
      await ensurePrivateDir(directory);
      const results = []; let done = 0;
      const manifest = async status => writePrivate(path.join(directory, 'manifest.json'), { status, report: report.id, from, to, stores, results });
      for (const store of stores) {
        if (signal?.aborted) break;
        let chunk;
        try {
          onProgress({ stage: 'selecting', store, done, total });
          await this.openReport(report, store);
          for (chunk of chunks) {
            if (signal?.aborted) break;
            onProgress({ stage: 'downloading', store, ...chunk, done, total });
            const saved = await this.downloadOne(report, store, chunk, directory);
            // ヘッダーだけのCSVは「売上ゼロ」と決めつけず、そのまま知らせる。
            results.push({ store, ...chunk, status: saved.dataLines ? 'downloaded' : 'header_only', ...saved });
            done++; await manifest('running');
          }
        } catch (e) {
          if (process.env.AIRREGI_DEBUG === '1') process.stderr.write(String(e?.message).split('Call log:')[0].replace(/https?:\/\/\S+/g, '[URL]') + '\n');
          const error = e instanceof AppError ? { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) }
            : { code: 'BROWSER_CHANGED', message: '画面を操作できませんでした。エアレジの画面が変わった可能性があります。' };
          // 店舗を開く前に止まったときは、その店舗の全期間を失敗にする。
          for (const c of chunk ? [chunk] : chunks) results.push({ store, ...c, status: 'failed', error });
          onProgress({ stage: 'failed', store, ...(chunk || {}), done, total, error });
          if (error.code === 'LOGIN_REQUIRED') break;
        }
      }
      for (const store of stores) for (const c of chunks) {
        if (!results.some(r => r.store === store && r.from === c.from && r.to === c.to))
          results.push({ store, ...c, status: 'not_attempted', error: signal?.aborted ? { code: 'CANCELLED', message: '中止したため取得していません。' } : { code: 'NOT_ATTEMPTED', message: '前の処理で止まったため取得していません。' } });
      }
      await this.saveAuth().catch(() => {});
      const ok = results.filter(r => r.status === 'downloaded' || r.status === 'header_only').length;
      const status = signal?.aborted ? 'cancelled' : ok === total ? 'completed' : ok ? 'partial' : 'failed';
      await manifest(status);
      return { status, directory, results };
    });
  }
}
