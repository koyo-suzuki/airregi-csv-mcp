import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const APP_NAME = 'airregi-csv-mcp';

export class AppError extends Error {
  constructor(code, message, details) { super(message); this.code = code; if (details) this.details = details; }
}

export function publicError(e) {
  if (e instanceof AppError) return { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) };
  return { code: 'INTERNAL', message: '処理に失敗しました。ログイン状態とエアレジの画面を確認してください。' };
}

export function defaultDataDirectory({ home = os.homedir(), platform = process.platform, env = process.env } = {}) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', APP_NAME);
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), APP_NAME);
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), APP_NAME);
}

export function dataDirectory(env = process.env) {
  return path.resolve(env.AIRREGI_APP_DATA || defaultDataDirectory({ env }));
}

export function safeName(s) {
  return String(s).normalize('NFKC').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^[.\s]+/, '_').replace(/[.\s]+$/, '').slice(0, 100) || 'CSV';
}

export function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function todayInJapan(now = Date.now()) {
  return new Date(now + 9 * 3600000).toISOString().slice(0, 10);
}

export function validateRange(from, to, now = Date.now()) {
  if (!validDate(from) || !validDate(to) || from > to) throw new AppError('INVALID_RANGE', '開始日と終了日を YYYY-MM-DD 形式で、開始日 ≦ 終了日 になるよう指定してください。');
  if (to > todayInJapan(now)) throw new AppError('FUTURE_RANGE', '終了日は日本時間の今日以前にしてください。');
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 365 * 10) throw new AppError('LONG_RANGE', '期間は10年以内で指定してください。');
}

// 期間を月ごとに分ける（エアレジは長い期間を1回で出せない帳票があるため）。
export function monthChunks(from, to, now = Date.now()) {
  validateRange(from, to, now);
  const chunks = [];
  for (let start = from; start <= to;) {
    const d = new Date(start + 'T00:00:00Z');
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    const stop = end < to ? end : to;
    chunks.push({ from: start, to: stop });
    start = new Date(Date.parse(stop) + 86400000).toISOString().slice(0, 10);
  }
  return chunks;
}

// 0o700 / 0o600 は Mac と Linux で効く。Windows ではユーザーフォルダの権限で守る。
export async function ensurePrivateDir(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
}

export async function writePrivate(file, value) {
  await ensurePrivateDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, typeof value === 'string' ? value : JSON.stringify(value, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
}

// CSVの中身を軽く確かめる。ヘッダーだけのCSVを「データあり」と扱わないため。
export function inspectCsv(buffer) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { text = new TextDecoder('shift_jis').decode(buffer); }
  text = text.replace(/^\uFEFF/, '');
  const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim() !== '');
  // 項目内の改行は数え分けないので、行数は目安。
  return { header: lines[0] ?? '', dataLines: Math.max(0, lines.length - 1) };
}
