// トロフィーと称号のテスト
// 実行方法（vocabulary フォルダで）： node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TROPHIES, TITLES, TROPHY_GROUPS, STAT_UNITS, longestStreak, trophyStats, achievementEvents,
  ownedTrophies, newTrophies, trophyEntry, titleOf, trophyMessages,
} from '../js/trophies.js';

test('トロフィーの決まりがそろっている（名前がかぶらない・称号のいちばん上は全部取ったとき）', () => {
  const keys = TROPHIES.map((t) => t.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(TROPHIES.length, 18);
  assert.equal(TITLES.at(-1).count, TROPHIES.length);
  const groups = new Set(TROPHY_GROUPS.map((g) => g.key));
  for (const trophy of TROPHIES) {
    assert.ok(groups.has(trophy.group), trophy.key);
    assert.ok(trophy.stat in STAT_UNITS, trophy.key);
  }
});

test('いちばん長い連続日数（月またぎ・とびとび）', () => {
  assert.equal(longestStreak([]), 0);
  assert.equal(longestStreak(['2026-11-04']), 1);
  assert.equal(longestStreak(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-03', '2026-11-04']), 3);
  assert.equal(longestStreak(new Set(['2026-11-02', '2026-11-01', '2026-11-01'])), 2); // 順番ばらばら・重なり
});

test('判定に使う数をまとめる', () => {
  const stats = trophyStats({
    stampList: [{ date: '2026-11-01', gold: true }, { date: '2026-11-02', gold: false }],
    walletEntries: [
      { type: 'use', item: 'rest', date: '2026-11-03' },
      { type: 'bingo', line: 'row1' },
      { type: 'bingo', line: 'all' },
      { type: 'goal', coins: 2 },
    ],
    dailyList: [{ answered: 30, choice: 4 }, { answered: 12 }],
    progressList: [
      { cardId: 'a', level: 5 }, { cardId: 'a', level: 6 }, // 同じ単語の両方向は1語
      { cardId: 'b', level: 4 }, { cardId: 'c', level: 7 },
    ],
    events: ['nightOwl'],
  });
  assert.deepEqual(stats, {
    longestStreak: 3, stamps: 2, golds: 1, bingoLines: 1, perfectMonths: 1,
    answered: 42, choiceCorrect: 4, mastered: 2, restDays: 1, nightOwl: 1, earlyBird: 0,
  });
});

test('夜ふかし・早起き', () => {
  assert.deepEqual(achievementEvents({ late: true, now: new Date(2026, 10, 5, 1) }), ['nightOwl']);
  assert.deepEqual(achievementEvents({ late: false, now: new Date(2026, 10, 5, 5, 59) }), ['earlyBird']);
  assert.deepEqual(achievementEvents({ late: false, now: new Date(2026, 10, 5, 4, 0) }), ['earlyBird']);
  assert.deepEqual(achievementEvents({ late: false, now: new Date(2026, 10, 5, 6, 0) }), []);
  // 夜中の2時（昨日の分はもう達成ずみ）は、早起きではない
  assert.deepEqual(achievementEvents({ late: false, now: new Date(2026, 10, 5, 2, 0) }), []);
});

test('条件を満たしていて、まだ持っていないトロフィーだけ取れる', () => {
  const stats = trophyStats({ stampList: [{ date: '2026-11-01' }, { date: '2026-11-02' }, { date: '2026-11-03' }] });
  assert.deepEqual(newTrophies(stats, new Map()).map((t) => t.key), ['streak3', 'stamp1']);
  const owned = ownedTrophies([trophyEntry(TROPHIES.find((t) => t.key === 'stamp1'), 1), { type: 'goal' }]);
  assert.deepEqual([...owned.keys()], ['stamp1']);
  assert.deepEqual(newTrophies(stats, owned).map((t) => t.key), ['streak3']);
});

test('通帳の1行', () => {
  assert.deepEqual(trophyEntry(TROPHIES[0], 5), { id: 'trophy:streak3', type: 'trophy', trophy: 'streak3', coins: 5, at: 5 });
});

test('称号はトロフィーの数で上がる', () => {
  assert.deepEqual(titleOf(0), { name: 'はじめの一歩', count: 0, next: { count: 3, name: '見習い' } });
  assert.equal(titleOf(2).name, 'はじめの一歩');
  assert.equal(titleOf(3).name, '見習い');
  assert.equal(titleOf(9).name, 'がんばりや');
  assert.deepEqual(titleOf(18), { name: '単語マスター', count: 18, next: null });
});

test('お知らせの文：名前・コインの合計・称号が上がったとき', () => {
  const [a, b, c] = TROPHIES;
  assert.deepEqual(trophyMessages([], 0), []);
  assert.deepEqual(trophyMessages([a], 0), ['🏆 トロフィー「3日連続」ゲット！ 🪙5']);
  assert.deepEqual(trophyMessages([a, b, c], 1), ['🏆 トロフィーを3個ゲット！ 🪙30', '🎖 称号が「見習い」になりました！']);
  const secret = TROPHIES.find((t) => t.secret);
  assert.match(trophyMessages([secret], 5)[0], /ひみつのトロフィー/);
});
