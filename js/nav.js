// =========================================================
// 画面移動の履歴の管理
//
// アプリの中で画面を移動するたびに、履歴に番号（0, 1, 2, ...）を付けて覚えておく。
// - 番号が 0 より大きければ、ひとつ前の画面がアプリの中にある →「戻る」で戻れる
// - 番号が 0 なら、アプリを開いた最初の画面 → 「戻る」ではなく親の画面へ移動する
// また、戻ったときに前のスクロール位置を復元できるよう、番号ごとに位置を覚えておく。
// =========================================================

let historyIndex = 0;
let started = false;
const scrollPositions = new Map();

// ブラウザ任せのスクロール復元は使わず、自分で復元する
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

// 新しい画面に入ったときに呼ぶ。戻る・進むで来たなら cameBack が true。
export function enterEntry() {
  const state = history.state;
  let cameBack;
  if (state && typeof state.idx === 'number') {
    historyIndex = state.idx;
    cameBack = !state.replaced;
    if (state.replaced) history.replaceState({ idx: historyIndex }, '');
  } else {
    historyIndex = started ? historyIndex + 1 : 0;
    history.replaceState({ idx: historyIndex }, '');
    cameBack = false;
  }
  started = true;
  return { cameBack };
}

// 今の画面のスクロール位置を覚える（別の画面へ移る直前に呼ぶ）
export function saveScroll() {
  if (started) scrollPositions.set(historyIndex, window.scrollY);
}

// 今の画面で前に覚えたスクロール位置
export function savedScroll() {
  return scrollPositions.get(historyIndex) ?? 0;
}

// ひとつ前の画面へ戻る。アプリの中に前の画面がなければ fallbackHash へ移動する。
export function goBack(fallbackHash = '#/home') {
  if (historyIndex > 0) {
    history.back();
  } else {
    replaceLocation(fallbackHash);
  }
}

// 今の画面を履歴に残さずに、別の画面へ移動する
// （例：単語帳を削除したあと、スマホの「戻る」で消えた単語帳に戻らないように）
export function replaceLocation(hash) {
  history.replaceState({ idx: historyIndex, replaced: true }, '', hash);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
