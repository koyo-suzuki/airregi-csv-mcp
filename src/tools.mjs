import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError, monthChunks, publicError } from './core.mjs';
import { describeReports, getReport } from './reports.mjs';
import { MAX_FILES } from './browser.mjs';

// MCPとコマンドで共通の入力チェック。取得を始める前に、合わない指定をすぐに知らせる。
export function planDownload({ report: reportId, stores, from, to, output_dir, now = Date.now() }) {
  const report = getReport(reportId);
  const chunks = monthChunks(from, to, now);
  if (!Array.isArray(stores) || !stores.length || new Set(stores).size !== stores.length) throw new AppError('INVALID_STORES', '店舗を1件以上、重複せずに指定してください。list_stores で店舗名を確認できます。');
  // 月単位の帳票などは、取得を始める前に期間を確かめる。
  if (report.checkPeriod) for (const c of chunks) report.checkPeriod(c, now);
  if (stores.length * chunks.length > MAX_FILES) throw new AppError('TOO_MANY', `一度に取得できるのは ${MAX_FILES} ファイル（店舗数 × 月数）までです。`);
  if (output_dir !== undefined && !path.isAbsolute(output_dir)) throw new AppError('INVALID_OUTPUT_DIR', 'output_dir は絶対パスで指定してください。');
  return { report, chunks };
}

export function stamp(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
}

// MCPに依存しない処理。テストではブラウザを差し替える。
export function createTools({ browser, dataDir, now = () => new Date() }) {
  const jobs = new Map();

  function jobView(job) {
    const { id, report, stores, from, to, status, directory, progress, results, error, startedAt, finishedAt } = job;
    return { job_id: id, report, stores, from, to, status, directory, progress, startedAt, finishedAt, ...(results ? { results } : {}), ...(error ? { error } : {}) };
  }

  return {
    list_reports() { return { reports: describeReports() }; },

    status() {
      const active = [...jobs.values()].filter(j => j.status === 'running').map(j => j.id);
      return { browserOpen: browser.isOpen(), busy: browser.busy, knownStores: browser.stores, runningJobs: active, dataDirectory: dataDir };
    },

    async open_login() { return await browser.openLogin(); },

    async list_stores() { return { stores: await browser.listStores() }; },

    start_download({ report: reportId, stores, from, to, output_dir }) {
      const { report, chunks } = planDownload({ report: reportId, stores, from, to, output_dir, now: now().getTime() });
      if (browser.busy) throw new AppError('BUSY', '別のエアレジ操作が実行中です。終わってからもう一度実行してください。');
      const id = randomUUID();
      const directory = output_dir ? path.resolve(output_dir) : path.join(dataDir, 'downloads', `${stamp(now())}_${report.id}`);
      const controller = new AbortController();
      const job = { id, report: report.id, stores, from, to, status: 'running', directory, controller,
        progress: { done: 0, total: stores.length * chunks.length }, startedAt: now().toISOString() };
      jobs.set(id, job);
      job.promise = browser.downloadBatch({ report, stores, from, to, directory, signal: controller.signal,
        onProgress: p => { job.progress = { ...job.progress, ...p }; } })
        .then(r => { job.status = r.status; job.results = r.results; job.progress.done = r.results.filter(x => x.status === 'downloaded' || x.status === 'header_only').length; })
        .catch(e => { job.status = 'failed'; job.error = publicError(e); })
        .finally(() => { job.finishedAt = now().toISOString(); });
      return { ...jobView(job), message: 'CSVの取得を始めました。get_download で進み具合と結果を確認してください。', verified: report.verified };
    },

    get_download({ job_id }) {
      const job = jobs.get(job_id);
      if (!job) throw new AppError('UNKNOWN_JOB', 'その job_id の取得はありません。MCPサーバーを再起動すると、それより前の取得は消えます。');
      return jobView(job);
    },

    cancel_download({ job_id }) {
      const job = jobs.get(job_id);
      if (!job) throw new AppError('UNKNOWN_JOB', 'その job_id の取得はありません。');
      if (job.status === 'running') job.controller.abort();
      return { job_id, status: job.status === 'running' ? 'cancelling' : job.status };
    },

    _jobs: jobs,
  };
}
