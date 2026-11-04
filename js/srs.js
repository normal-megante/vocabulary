// =========================================================
// 間隔反復のしくみ（覚えた単語はたまに、苦手な単語は頻繁に出す）
//
// 単語 × 出題の向き（表→裏 / 裏→表）ごとに「覚え具合の記録」を持つ。
//   level        : 段階（0〜7）。高いほどよく覚えている
//   due          : 次に出す日（例 '2026-11-07'）
//   reps         : 答えた回数（0 なら「まだ出ていない新しい単語」）
//   lapses       : 覚えていたのに忘れた回数
//   firstStudied : 初めて答えた日
//   lastStudied  : 最後に答えた日
//   lastResult   : 最後の答え（good / hard / again / choice）
//   halfStep     : 4択の正解が「半分」たまっている（true のとき、次の4択の正解で段階 +1）
//   lastFormat   : 最後に答えた出し方（flip / choice / type。学習画面が記録する）
//   lastAssist   : 最後に答えたときに使ったアイテム（'hint' / 'choices'。使っていなければ null。学習画面が記録する）
//
// 画面やデータ保存とは関係のない「計算だけ」のファイル。
// tests/srs.test.mjs で動きを確かめられる。
// =========================================================
import { INTERVALS, ASSIST_INTERVAL } from './defaults.js';
import { toDateKey } from './util.js';

export const MAX_LEVEL = INTERVALS.length - 1;

// 単語帳の「出題の向き」の設定から、使う向きの一覧を作る
//   'f' = 表→裏、'b' = 裏→表
export function directionsOf(setting) {
  if (setting === 'forward') return ['f'];
  if (setting === 'backward') return ['b'];
  return ['f', 'b'];
}

export function progressId(cardId, dir) {
  return `${cardId}:${dir}`;
}

// まだ一度も出ていない単語の記録（保存はまだしない）
export function newProgress(card, dir) {
  return {
    id: progressId(card.id, dir),
    cardId: card.id,
    deckId: card.deckId,
    dir,
    level: 0,
    due: null,
    reps: 0,
    lapses: 0,
    firstStudied: null,
    lastStudied: null,
    lastResult: null,
    halfStep: false,
  };
}

export function isNew(progress) {
  return !progress || !progress.reps;
}

// ---- 日付の計算（'2026-11-04' の形の文字で扱う） ----
export function addDays(dateKey, days) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return toDateKey(new Date(y, m - 1, d + days));
}

export function daysBetween(fromKey, toKey) {
  const utc = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(toKey) - utc(fromKey)) / 86400000);
}

// ---------------------------------------------------------
// 答えた結果から、次の覚え具合を計算する
//   grade = 'good'   : 覚えてた・入力で正解 → 段階 +1
//           'choice' : 4択で正解 → ふつうの正解の半分の重さ（勘でも当たるので）
//                      1回目は段階そのまま（同じ間隔でもう一度出す）、2回たまると段階 +1
//           'hard'   : あやしい → 段階 −1（最低1）
//           'again'  : 忘れてた・不正解 → 段階0、今日もう一度
// ※ 予定の日より前に解いた（前倒し）ときに正解なら、記録は変えない。
//    （1日に何度も解いて、段階が一気に上がりすぎないように）
// ※ assisted（ヒント・選択肢表示を使った）ときは、正解でも段階を上げずに、明日もう一度出す
//    （ASSIST_INTERVAL 日後）。あやしいなら段階 −1（最低1）で、やはり明日。忘れてた・不正解はいつもと同じ。
// ---------------------------------------------------------
export function schedule(progress, grade, today, { assisted = false } = {}) {
  const wasNew = isNew(progress);
  const early = !wasNew && progress.due > today;
  let { level, due, lapses } = progress;
  let halfStep = progress.halfStep ?? false;

  if (assisted && grade !== 'again') {
    if (grade === 'hard') level = Math.max(1, level - 1);
    due = addDays(today, ASSIST_INTERVAL);
    halfStep = false;
  } else if (grade === 'good') {
    if (!early) {
      level = Math.min(MAX_LEVEL, level + 1);
      due = addDays(today, INTERVALS[level]);
      halfStep = false;
    }
  } else if (grade === 'choice') {
    if (!early) {
      if (halfStep) {
        level = Math.min(MAX_LEVEL, level + 1);
        halfStep = false;
      } else {
        halfStep = true;
      }
      due = addDays(today, Math.max(1, INTERVALS[level]));
    }
  } else if (grade === 'hard') {
    level = Math.max(1, level - 1);
    due = addDays(today, INTERVALS[level]);
    halfStep = false;
  } else {
    if (level > 0) lapses += 1;
    level = 0;
    due = today;
    halfStep = false;
  }

  return {
    ...progress,
    level,
    due,
    lapses,
    halfStep,
    reps: progress.reps + 1,
    firstStudied: progress.firstStudied ?? today,
    lastStudied: today,
    lastResult: grade,
  };
}

// ボタンの下に出す「次はいつ出るか」の言葉
export function nextLabel(progress, grade, today, options = {}) {
  if (grade === 'again') return 'もう一度';
  const next = schedule(progress, grade, today, options);
  if (!isNew(progress) && next.due === progress.due && next.level === progress.level) return 'そのまま';
  const days = daysBetween(today, next.due);
  if (days <= 0) return '今日';
  if (days === 1) return '明日';
  if (days < 30) return `${days}日後`;
  return `約${Math.round(days / 30)}か月後`;
}

// ---------------------------------------------------------
// 出題する問題を選ぶ
//   1. 復習（次に出す日が来たもの）… 段階が低い（苦手な）ものから
//   2. 裏→表 の新しい問題 … 表→裏 を前の日までに一度やった単語だけ
//   3. 新しい単語 … 1日の上限まで、登録した順に
//   4. 前倒しの復習（次に出す日がまだ先のもの）… 日が近いものから
//   5. 今日すでに解いたもの … 段階が低いものから（きょうのぶんに届かないとき用）
// 同じ単語の「表→裏」と「裏→表」は、1回の学習の中では片方だけ出す。
// ---------------------------------------------------------
function classify({ cards, progressList, directions, today }) {
  const dirs = directionsOf(directions);
  const saved = new Map(progressList.map((p) => [p.id, p]));
  const tiers = { due: [], reverse: [], fresh: [], early: [], extra: [] };

  for (const card of cards) {
    for (const dir of dirs) {
      const progress = saved.get(progressId(card.id, dir));
      if (isNew(progress)) {
        const item = { card, dir, progress: newProgress(card, dir) };
        if (dir === 'b' && dirs.includes('f')) {
          const forward = saved.get(progressId(card.id, 'f'));
          if (!isNew(forward) && forward.firstStudied < today) {
            tiers.reverse.push({ ...item, kind: 'reverse' });
          }
        } else {
          tiers.fresh.push({ ...item, kind: 'new' });
        }
      } else if (progress.due <= today) {
        tiers.due.push({ card, dir, progress, kind: 'due' });
      } else if (progress.lastStudied === today) {
        tiers.extra.push({ card, dir, progress, kind: 'extra' });
      } else {
        tiers.early.push({ card, dir, progress, kind: 'early' });
      }
    }
  }

  const byDue = (a, b) => (a.progress.due < b.progress.due ? -1 : a.progress.due > b.progress.due ? 1 : 0);
  const byLevel = (a, b) => a.progress.level - b.progress.level;
  tiers.due.sort((a, b) => byLevel(a, b) || byDue(a, b));
  tiers.early.sort((a, b) => byDue(a, b) || byLevel(a, b));
  tiers.extra.sort(byLevel);
  return tiers;
}

export function buildQueue({ cards, progressList, directions, today, newLimit, size }) {
  const tiers = classify({ cards, progressList, directions, today });
  const queue = [];
  const usedCards = new Set();

  const take = (items, limit = Infinity) => {
    let taken = 0;
    for (const item of items) {
      if (queue.length >= size || taken >= limit) break;
      if (usedCards.has(item.card.id)) continue;
      queue.push(item);
      usedCards.add(item.card.id);
      taken++;
    }
  };
  take(tiers.due);
  take(tiers.reverse);
  take(tiers.fresh, Math.max(0, newLimit));
  take(tiers.early);
  take(tiers.extra);
  return queue;
}

// ホーム画面用：今日の復習の数と、新しく出せる数
export function countAvailable({ cards, progressList, directions, today, newLimit }) {
  const tiers = classify({ cards, progressList, directions, today });
  return {
    due: tiers.due.length,
    fresh: Math.min(tiers.fresh.length, Math.max(0, newLimit)) + tiers.reverse.length,
  };
}
