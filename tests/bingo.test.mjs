// スタンプカードのビンゴのテスト
// 実行方法（vocabulary フォルダで）： node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthLines, monthBingo, findBingos, bingoEntry, bingoLabel, bingoMessage, filledDates,
} from '../js/bingo.js';
import { COIN_REWARDS } from '../js/defaults.js';

// 2026年11月：1日が日曜。1〜7, 8〜14, 15〜21, 22〜28, 29〜30 の5週
const nov = (d) => `2026-11-${String(d).padStart(2, '0')}`;
const days = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => nov(from + i));

test('1か月の列：横は週の数、縦は7曜日', () => {
  const lines = monthLines(2026, 11);
  assert.equal(lines.filter((l) => l.kind === 'row').length, 5);
  assert.equal(lines.filter((l) => l.kind === 'col').length, 7);
  assert.deepEqual(lines.find((l) => l.key === 'row5').dates, [nov(29), nov(30)]);
  assert.deepEqual(lines.find((l) => l.key === 'col0').dates, [nov(1), nov(8), nov(15), nov(22), nov(29)]);
  // 2026年12月は火曜はじまり：最初の週は 1〜5日
  assert.deepEqual(monthLines(2026, 12).find((l) => l.key === 'row1').dates.length, 5);
});

test('横1列（1週間）がそろったらビンゴ', () => {
  const found = findBingos(new Set(days(8, 14)));
  assert.deepEqual(found, [{ id: 'bingo:2026-11:row2', month: '2026-11', key: 'row2', coins: COIN_REWARDS.bingoLine }]);
  // 1日でも欠けたらビンゴではない
  assert.deepEqual(findBingos(new Set(days(8, 13))), []);
});

test('縦1列（その月の毎週同じ曜日）がそろったらビンゴ', () => {
  const mondays = [nov(2), nov(9), nov(16), nov(23), nov(30)];
  assert.deepEqual(findBingos(new Set(mondays)).map((b) => b.key), ['col1']);
  assert.deepEqual(findBingos(new Set(mondays.slice(0, 4))), []);
});

test('短い週も1列・1か月ぜんぶでパーフェクト', () => {
  assert.deepEqual(findBingos(new Set([nov(29), nov(30)])).map((b) => b.key), ['row5']);
  const all = findBingos(new Set(days(1, 30)));
  assert.equal(all.filter((b) => b.key !== 'all').length, 12); // 横5 ＋ 縦7
  assert.equal(all.find((b) => b.key === 'all').coins, COIN_REWARDS.bingoAll);
});

test('月ごとに別のカード（月をまたいだ週は、それぞれの月で数える）', () => {
  // 10月25日〜31日（10月の最後の週）と 11月1日〜7日
  const filled = new Set([...Array.from({ length: 7 }, (_, i) => `2026-10-${25 + i}`), ...days(1, 7)]);
  assert.deepEqual(findBingos(filled).map((b) => b.id), ['bingo:2026-10:row5', 'bingo:2026-11:row1']);
});

test('カレンダー用：ビンゴした日・リーチ（今日より前の欠けはリーチにしない）', () => {
  const filled = new Set([...days(1, 7), ...days(8, 13)]);
  const result = monthBingo(2026, 11, filled, nov(14));
  assert.equal(result.lines, 1);
  assert.equal(result.bingoDates.has(nov(7)), true);
  assert.equal(result.bingoDates.has(nov(8)), false);
  assert.equal(result.reach, 1);                    // 第2週は14日だけ足りない
  assert.deepEqual([...result.reachDates], [nov(14)]);
  assert.equal(result.all, false);
  // 15日になったら、14日はもう埋まらないのでリーチではない
  assert.equal(monthBingo(2026, 11, filled, nov(15)).reach, 0);
});

test('お休みの日もそろった扱い・通帳の行・名前とお知らせ', () => {
  const filled = filledDates(days(1, 6), [nov(7)]);
  const [bingo] = findBingos(filled);
  assert.equal(bingo.key, 'row1');
  assert.deepEqual(bingoEntry(bingo, 1), { id: 'bingo:2026-11:row1', type: 'bingo', month: '2026-11', line: 'row1', coins: COIN_REWARDS.bingoLine, at: 1 });
  assert.equal(bingoLabel(bingo), '11月 第1週');
  assert.equal(bingoLabel({ month: '2026-11', key: 'col3' }), '11月 水曜日');
  assert.equal(bingoLabel({ month: '2026-11', key: 'all' }), '11月 ぜんぶ');
  assert.match(bingoMessage([bingo]), /ビンゴ！ 11月 第1週 🪙5/);
});
