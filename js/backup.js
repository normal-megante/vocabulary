// =========================================================
// バックアップのファイルの形と、読み込むときの点検
//
// バックアップのファイル（JSON）の中身：
//   {
//     app: 'vocabulary',        ← このアプリのファイルだという印
//     format: 1,                ← ファイルの形のバージョン
//     appVersion: '0.4.0…',     ← 書き出したときのアプリのバージョン
//     exportedAt: '2026-11-04T12:34:56.000Z',  ← 書き出した日時
//     data: { decks: [...], cards: [...], progress: [...], daily: [...], settings: [...] }
//   }
//
// 画面やデータ保存とは関係のない「計算だけ」のファイル。
// tests/backup.test.mjs で動きを確かめられる。
// =========================================================
import { toDateKey } from './util.js';

// ファイルの形を変えたときは、この数字を上げて parseBackup() に「古い形の直し方」を足す
export const BACKUP_FORMAT = 1;

// バックアップに入れるもの（IndexedDB の棚の名前）と、それぞれに必ずある項目
const STORES = {
  decks: { label: '単語帳', required: ['id', 'name'] },
  cards: { label: '単語', required: ['id', 'deckId', 'front', 'back'] },
  progress: { label: '覚え具合', required: ['id', 'cardId', 'deckId', 'dir'] },
  daily: { label: '学習記録', required: ['id', 'deckId', 'date'] },
  settings: { label: '設定', required: ['key'] },
};
export const STORE_NAMES = Object.keys(STORES);

// 全データから、バックアップの中身を作る
export function makeBackup(data, { appVersion, exportedAt = new Date().toISOString() } = {}) {
  const copy = {};
  for (const name of STORE_NAMES) copy[name] = data[name] ?? [];
  return { app: 'vocabulary', format: BACKUP_FORMAT, appVersion, exportedAt, data: copy };
}

// ファイル名（例：vocabulary-backup-2026-11-04-2130.json）
export function backupFileName(date = new Date()) {
  const time = `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;
  return `vocabulary-backup-${toDateKey(date)}-${time}.json`;
}

// 読み込んだファイルの文字を点検する
//   うまくいけば { ok: true, backup, summary: { decks, cards, exportedAt } }
//   だめなら     { ok: false, error: '理由' }
export function parseBackup(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return fail('バックアップのファイルではないようです（中身を読み取れませんでした）。');
  }
  if (!json || typeof json !== 'object' || json.app !== 'vocabulary' || typeof json.format !== 'number') {
    return fail('この単語帳アプリのバックアップではないようです。');
  }
  if (json.format > BACKUP_FORMAT) {
    return fail('新しいバージョンのアプリで作られたバックアップです。アプリを最新にしてから読み込んでください。');
  }

  const source = json.data && typeof json.data === 'object' ? json.data : {};
  const data = {};
  for (const [name, { label, required }] of Object.entries(STORES)) {
    const records = source[name] ?? [];
    if (!Array.isArray(records)) return fail(`ファイルが壊れているようです（${label}）。`);
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const broken = !record || typeof record !== 'object'
        || required.some((field) => record[field] === undefined || record[field] === null);
      if (broken) return fail(`ファイルが壊れているようです（${label}の${i + 1}件目）。`);
    }
    data[name] = records;
  }

  return {
    ok: true,
    backup: { ...json, data },
    summary: { decks: data.decks.length, cards: data.cards.length, exportedAt: json.exportedAt ?? null },
  };
}

function fail(error) {
  return { ok: false, error };
}
