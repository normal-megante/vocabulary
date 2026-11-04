// =========================================================
// 出し方（めくる・4択・入力）のための計算
//   ・4択の選択肢づくり
//   ・入力した答えの判定
//   ・「おまかせ」のときの出し方選び
//
// 画面とは関係のない「計算だけ」のファイル。
// tests/quiz.test.mjs で動きを確かめられる。
// =========================================================
import { normalizeKey } from './util.js';
import { directionsOf } from './srs.js';

// 出し方の一覧（学習を始めるときに選ぶ）
export const FORMATS = [
  { id: 'flip', emoji: '🃏', label: 'めくる', note: '答えを見て、自分で採点' },
  { id: 'choice', emoji: '🔢', label: '4択', note: '4つの中から選ぶ（正解は半分の重さ）' },
  { id: 'type', emoji: '⌨️', label: '入力', note: '答えを打ち込む' },
  { id: 'auto', emoji: '🎲', label: 'おまかせ', note: '1問ごとに出し方が変わる' },
];

export const CHOICE_COUNT = 4;

// 問題の文字と答えの文字（向きで入れ替わる）
export function questionOf(card, dir) {
  return dir === 'f' ? card.front : card.back;
}
export function answerOf(card, dir) {
  return dir === 'f' ? card.back : card.front;
}

// ---------------------------------------------------------
// 4択
// ---------------------------------------------------------

// 同じ単語帳から、ハズレに使える答えを集める（正解と同じに見えるものや、重なりは除く）
function wrongAnswerPool(card, dir, cards) {
  const seen = new Set([normalizeKey(answerOf(card, dir))]);
  const pool = [];
  for (const other of cards) {
    if (other.id === card.id) continue;
    const text = answerOf(other, dir);
    const key = normalizeKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    pool.push(text);
  }
  return pool;
}

// 4択の選択肢を作る。ハズレが3つそろわなければ null。
//   → { options: ['…', '…', '…', '…'], correctIndex: 正解の位置（0〜3） }
export function buildChoices(card, dir, cards, random = Math.random) {
  const pool = wrongAnswerPool(card, dir, cards);
  if (pool.length < CHOICE_COUNT - 1) return null;
  const answer = answerOf(card, dir);
  const options = shuffle([answer, ...shuffle(pool, random).slice(0, CHOICE_COUNT - 1)], random);
  return { options, correctIndex: options.indexOf(answer) };
}

// この単語帳で4択が使えるか（答えの種類が4つ以上ある向きが1つでもあれば使える）
export function canUseChoice(cards, directions) {
  return directionsOf(directions).some((dir) => {
    const keys = new Set(cards.map((card) => normalizeKey(answerOf(card, dir))).filter(Boolean));
    return keys.size >= CHOICE_COUNT;
  });
}

// ---------------------------------------------------------
// 入力
// ---------------------------------------------------------

// 比べるときの形にそろえる
//   全角半角・大文字小文字・前後と連続の空白（normalizeKey）に加えて、
//   ひらがなとカタカナ（ねこ／ネコ）、「.」「。」「!」「?」「〜」などの記号、
//   ’ と ' の違いも気にしない
export function compareKey(text) {
  return normalizeKey(text)
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/[’‘`]/g, "'")
    .replace(/[.。!?~〜]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 正解として認める答えの一覧（比べる形にしたもの）
//   「走る、走らせる」→ 全体／走る／走らせる（「、」「,」「/」「;」で区切ったどれか1つでよい）
//   「run (fast)」  → 全体／run（かっこの中は書かなくてもよい）
export function acceptedAnswers(answer) {
  const whole = String(answer ?? '');
  const pieces = [whole, ...whole.split(/[、,，/／;；\n]/)];
  const keys = new Set();
  for (const piece of pieces) {
    for (const text of [piece, piece.replace(/[（(][^）)]*[）)]/g, ' ')]) {
      const key = compareKey(text);
      if (key) keys.add(key);
    }
  }
  return [...keys];
}

// 入力した答えが合っているか
export function checkTyped(input, answer) {
  const key = compareKey(input);
  return key !== '' && acceptedAnswers(answer).includes(key);
}

// ---------------------------------------------------------
// ヒント（アイテム）
// ---------------------------------------------------------

// 伏せずにそのまま見せる文字（空白・区切り・かっこ・記号）
const HINT_KEEP = /[\s、,，/／;；()（）・\-‐－~〜.。!?！？'’"“”「」]/;

// 答えの最初の1文字だけ見せて、ほかの文字は伏せる（空白や区切りの記号はそのまま見せる）
//   'apple'   → a ＿ ＿ ＿ ＿（5文字）
//   'take off' → t ＿ ＿ ＿ ␣ ＿ ＿ ＿（7文字）
//   → { cells: [{ type: 'open'（見せる文字）| 'blank'（伏せた文字）| 'mark'（記号）| 'space', ch }],
//       letters: 文字数（記号・空白は数えない） }
export function hintOf(answer) {
  let opened = false;
  let letters = 0;
  const cells = [...String(answer ?? '').trim()].map((ch) => {
    if (/\s/.test(ch)) return { type: 'space', ch: ' ' };
    if (HINT_KEEP.test(ch)) return { type: 'mark', ch };
    letters++;
    if (opened) return { type: 'blank', ch: '' };
    opened = true;
    return { type: 'open', ch };
  });
  return { cells, letters };
}

// ---------------------------------------------------------
// おまかせ
// ---------------------------------------------------------

// 1問ごとの出し方を決める
//   format   : 学習を始めるときに選んだ出し方（flip / choice / type / auto）
//   hasChoices : この問題で4択を作れるか
export function pickFormat(format, hasChoices, random = Math.random) {
  if (format === 'auto') {
    const list = hasChoices ? ['flip', 'choice', 'type'] : ['flip', 'type'];
    return list[Math.floor(random() * list.length)];
  }
  if (format === 'choice' && !hasChoices) return 'flip'; // 4択が作れない問題は、めくるで出す
  return format;
}

// 並べ替え（元の並びは変えずに、新しく作る）
export function shuffle(list, random = Math.random) {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
