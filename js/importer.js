// =========================================================
// 一括登録：貼り付けられた文字を「表・裏・例文・メモ」に分ける
//
// 1行 = 1単語。列の区切りはタブ。
// Excel や Google スプレッドシートで4列に並べた範囲をコピーすると、
// 列と列の間に自動でタブが入るので、そのまま貼り付ければよい。
//
// ※ 画面やデータ保存とは関係のない「計算だけ」のファイルなので、
//    tests/importer.test.mjs で動きを確かめられる。
// =========================================================
import { normalizeKey } from './util.js';

// 1行目がこの組み合わせなら「見出し」とみなして飛ばす
const HEADER_FRONT = ['表', 'おもて', 'front'];
const HEADER_BACK = ['裏', 'うら', 'back'];

// 貼り付けられた文字を読み取る
// 返り値：
//   rows          : 登録できる行 [{ line, front, back, example, note }]
//   errors        : 読み取れなかった行 [{ line, reason, text }]
//   headerSkipped : 1行目を見出しとして飛ばしたか
export function parseImportText(text) {
  const rows = [];
  const errors = [];
  let headerSkipped = false;
  let seenContent = false;

  for (const record of splitTabText(text)) {
    const cells = record.cells.map((cell) => cell.trim());
    if (cells.every((cell) => cell === '')) continue; // 空の行は無視

    if (!seenContent && isHeader(cells)) {
      headerSkipped = true;
      seenContent = true;
      continue;
    }
    seenContent = true;

    const [front = '', back = '', example = '', note = ''] = cells;
    const preview = cells.filter(Boolean).join(' ').slice(0, 30);
    if (cells.length < 2) {
      errors.push({ line: record.line, reason: 'タブで区切られていません', text: preview });
    } else if (!front) {
      errors.push({ line: record.line, reason: '「表」が空です', text: preview });
    } else if (!back) {
      errors.push({ line: record.line, reason: '「裏」が空です', text: preview });
    } else {
      rows.push({ line: record.line, front, back, example, note });
    }
  }
  return { rows, errors, headerSkipped };
}

function isHeader(cells) {
  return HEADER_FRONT.includes(normalizeKey(cells[0])) && HEADER_BACK.includes(normalizeKey(cells[1]));
}

// 読み取った行を、今ある単語と照らし合わせて「どう登録するか」を決める
//   mode = 'skip'      : 同じ「表」の単語があれば登録しない
//          'overwrite' : 同じ「表」の単語があれば内容を上書きする
//          'add'       : 気にせず全部追加する
// 返り値：
//   toAdd    : 新しく追加する単語 [{ front, back, example, note }]
//   toUpdate : 上書きする単語（今ある単語に新しい内容を入れたもの）
//   skipped  : 登録しない行の数
export function planImport(rows, existingCards, mode = 'skip') {
  const existing = new Map();
  for (const card of existingCards) {
    const key = normalizeKey(card.front);
    if (!existing.has(key)) existing.set(key, card);
  }
  const added = new Map(); // 今回の貼り付けの中で、すでに追加予定にした単語
  const toAdd = [];
  const updates = new Map();
  let skipped = 0;

  for (const row of rows) {
    const data = { front: row.front, back: row.back, example: row.example, note: row.note };
    const key = normalizeKey(row.front);

    if (mode === 'add') {
      toAdd.push(data);
    } else if (existing.has(key)) {
      if (mode === 'overwrite') {
        const card = existing.get(key);
        updates.set(card.id, { ...card, ...data });
      } else {
        skipped++;
      }
    } else if (added.has(key)) {
      // 貼り付けた中に同じ「表」が2回以上出てきたとき
      if (mode === 'overwrite') {
        Object.assign(added.get(key), data); // あとの行の内容で上書き
      } else {
        skipped++;
      }
    } else {
      added.set(key, data);
      toAdd.push(data);
    }
  }
  return { toAdd, toUpdate: [...updates.values()], skipped };
}

// ---------------------------------------------------------
// タブ区切りの文字を、行と列に分ける。
// スプレッドシートのセルの中に改行があると、そのセルは "..." で囲まれて
// コピーされる（中の " は "" になる）ので、それにも対応する。
// ---------------------------------------------------------
function splitTabText(rawText) {
  const text = String(rawText ?? '').replace(/\r\n?/g, '\n');
  const records = [];
  let cells = [];
  let line = 1;        // 今読んでいる行の番号
  let recordLine = 1;  // 今の単語が始まった行の番号（エラー表示用）
  let i = 0;

  while (true) {
    let value;
    const quoted = text[i] === '"' ? readQuoted(text, i) : null;
    if (quoted) {
      value = quoted.value;
      line += quoted.newlines;
      i = quoted.end;
    } else {
      let end = i;
      while (end < text.length && text[end] !== '\t' && text[end] !== '\n') end++;
      value = text.slice(i, end);
      i = end;
    }
    cells.push(value);

    if (i >= text.length) {
      records.push({ line: recordLine, cells });
      break;
    }
    if (text[i] === '\t') {
      i++;
    } else {
      // 改行：次の単語へ
      records.push({ line: recordLine, cells });
      cells = [];
      i++;
      line++;
      recordLine = line;
    }
  }
  return records;
}

// "..." で囲まれたセルを読む。囲みになっていなければ null。
function readQuoted(text, start) {
  let value = '';
  let newlines = 0;
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      if (text[i + 1] === '"') {
        value += '"';
        i += 2;
        continue;
      }
      const next = text[i + 1];
      if (next === undefined || next === '\t' || next === '\n') {
        return { value, end: i + 1, newlines };
      }
      return null; // 閉じの " のあとに文字が続く → ふつうの文字としての "
    }
    if (ch === '\n') newlines++;
    value += ch;
    i++;
  }
  return null; // 閉じの " がない
}
