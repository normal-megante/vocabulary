// =========================================================
// スタンプカードのビンゴ
//
// ・全体のスタンプカードの1か月分（日曜はじまりのカレンダー）が、1枚のビンゴカード。
// ・横1列（1週間）か、縦1列（その月の毎週同じ曜日）の日が全部そろったらビンゴ → コイン。
//   1か月ぜんぶそろったら、さらにボーナス。
// ・月のはじめと終わりの短い週も1列として数える（その月の日だけで判定）。
// ・そろった日＝全体のスタンプがある日と、お休みチケットを使った日（💤）。
// ・もらったビンゴは通帳（wallet）に 'bingo:2026-11:row1' のような id で記録する（二重どりしない）。
//
// 画面やデータ保存とは関係のない「計算だけ」のファイル。
// tests/bingo.test.mjs で動きを確かめられる。
// =========================================================
import { monthWeeks } from './stamps.js';
import { COIN_REWARDS } from './defaults.js';

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

// その月のビンゴの列（横＝週 row1〜、縦＝曜日 col0〜6。0 が日曜）
//   → [{ key: 'row1', kind: 'row', dates: [...] }, ...]
export function monthLines(year, month) {
  const weeks = monthWeeks(year, month);
  const lines = weeks.map((week, i) => ({ key: `row${i + 1}`, kind: 'row', dates: week.filter(Boolean) }));
  for (let day = 0; day < 7; day++) {
    lines.push({ key: `col${day}`, kind: 'col', dates: weeks.map((week) => week[day]).filter(Boolean) });
  }
  return lines;
}

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

// その月の日付を全部
function monthDates(year, month) {
  return monthWeeks(year, month).flat().filter(Boolean);
}

// ---------------------------------------------------------
// 1か月分のビンゴのようす（カレンダーの表示用）
//   filled : そろった日の Set
//   today  : 今日（リーチの判定用。足りない日が今日より前なら、もうそろわないのでリーチにしない）
//   → { bingoDates: ビンゴした列に入っている日の Set, lines: ビンゴの本数, all: 全部そろったか,
//       reach: リーチの本数, reachDates: あと1日でビンゴになる日の Set }
// ---------------------------------------------------------
export function monthBingo(year, month, filled, today) {
  const bingoDates = new Set();
  const reachDates = new Set();
  let lines = 0;
  let reach = 0;
  for (const line of monthLines(year, month)) {
    const missing = line.dates.filter((date) => !filled.has(date));
    if (missing.length === 0) {
      lines++;
      for (const date of line.dates) bingoDates.add(date);
    } else if (missing.length === 1 && missing[0] >= today) {
      reach++;
      reachDates.add(missing[0]);
    }
  }
  const all = monthDates(year, month).every((date) => filled.has(date));
  return { bingoDates, lines, all, reach, reachDates };
}

// ---------------------------------------------------------
// そろっているビンゴを全部さがす（コインを渡すため）
//   filled : そろった日の Set
//   → [{ id: 'bingo:2026-11:row1', month: '2026-11', key: 'row1' か 'col0' か 'all', coins }]
// ---------------------------------------------------------
export function findBingos(filled) {
  const months = new Set([...filled].map((date) => date.slice(0, 7)));
  const found = [];
  for (const ym of [...months].sort()) {
    const [year, month] = ym.split('-').map(Number);
    for (const line of monthLines(year, month)) {
      if (line.dates.every((date) => filled.has(date))) {
        found.push({ id: `bingo:${ym}:${line.key}`, month: ym, key: line.key, coins: COIN_REWARDS.bingoLine });
      }
    }
    if (monthDates(year, month).every((date) => filled.has(date))) {
      found.push({ id: `bingo:${ym}:all`, month: ym, key: 'all', coins: COIN_REWARDS.bingoAll });
    }
  }
  return found;
}

// 通帳の1行にする
export function bingoEntry(bingo, at = Date.now()) {
  return { id: bingo.id, type: 'bingo', month: bingo.month, line: bingo.key, coins: bingo.coins, at };
}

// ビンゴの名前（例：「11月 第2週」「11月 水曜日」「11月 ぜんぶ」）
export function bingoLabel(bingo) {
  const month = Number(bingo.month.slice(5));
  if (bingo.key === 'all') return `${month}月 ぜんぶ`;
  if (bingo.key.startsWith('row')) return `${month}月 第${bingo.key.slice(3)}週`;
  return `${month}月 ${WEEKDAY_NAMES[Number(bingo.key.slice(3))]}曜日`;
}

// ビンゴしたときのお知らせの文
export function bingoMessage(bingos) {
  const coins = bingos.reduce((sum, bingo) => sum + bingo.coins, 0);
  const lines = bingos.filter((bingo) => bingo.key !== 'all');
  const perfect = bingos.some((bingo) => bingo.key === 'all');
  const what = bingos.length <= 2 ? bingos.map(bingoLabel).join('・') : `${lines.length}本`;
  return `🎯 ビンゴ！ ${what}${perfect ? '（1か月パーフェクト！）' : ''} 🪙${coins} ゲット！`;
}

// ビンゴで「そろった」とみなす日（全体のスタンプの日 ＋ お休みの日）
export function filledDates(stampDates, restDates) {
  return new Set([...stampDates, ...restDates]);
}
