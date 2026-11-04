// =========================================================
// あちこちで使う、小さな便利機能
// =========================================================

// 画面に文字を出すときの安全対策。
// 単語に「<」などの記号が入っていても、画面が崩れないように変換する。
export function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// 単語帳や単語に付ける、重ならない名札（ID）を作る。
// 「作った時刻」＋「ランダムな文字」の組み合わせ。
export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const random = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${Date.now().toString(36)}-${random}`;
}

// 文字を「比べやすい形」にそろえる（同じ単語かどうかの判定や、検索に使う）
//   全角英数字→半角、大文字→小文字、前後の空白を消す、空白の連続を1つに
export function normalizeKey(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

// 日付を「2026-11-04」の形の文字にする（スマホの時計の時刻で）。
export function toDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 日時を「11月4日（水）21:30」の形の文字にする。
export function formatDateTimeJa(date) {
  const time = `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${formatDateJa(date)} ${time}`;
}

// 日付を「11月4日（水）」の形の文字にする。
export function formatDateJa(date = new Date()) {
  const week = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
  return `${date.getMonth() + 1}月${date.getDate()}日（${week}）`;
}
