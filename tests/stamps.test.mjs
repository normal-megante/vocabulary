// きょうのぶん・スタンプのテスト
// 実行方法（vocabulary フォルダで）： node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  studyDay, addAnswer, recheckGoal, makeOverallStamp, streakOf, monthWeeks, rebuildStamps, isAchieved,
} from '../js/stamps.js';

// 2026年11月5日の、指定した時刻
const at = (hour, minute = 0) => new Date(2026, 10, 5, hour, minute);
const emptyDaily = { id: 'd1:2026-11-05', deckId: 'd1', date: '2026-11-05', answered: 0, newCount: 0 };

test('数える日：猶予の時間に、昨日が未達成なら昨日の分', () => {
  assert.deepEqual(studyDay({ now: at(1, 30), graceHour: 3, goal: 20, yesterdayAchieved: false }),
    { day: '2026-11-04', late: true });
  // 2:59 まではまだ昨日の分
  assert.equal(studyDay({ now: at(2, 59), graceHour: 3, goal: 20, yesterdayAchieved: false }).day, '2026-11-04');
});

test('数える日：昨日が達成ずみ・猶予時刻を過ぎた・猶予なし・きょうのぶん0 なら今日の分', () => {
  assert.deepEqual(studyDay({ now: at(1), graceHour: 3, goal: 20, yesterdayAchieved: true }),
    { day: '2026-11-05', late: false });
  assert.equal(studyDay({ now: at(3, 0), graceHour: 3, goal: 20, yesterdayAchieved: false }).day, '2026-11-05');
  assert.equal(studyDay({ now: at(0, 10), graceHour: 0, goal: 20, yesterdayAchieved: false }).day, '2026-11-05');
  assert.equal(studyDay({ now: at(1), graceHour: 3, goal: 0, yesterdayAchieved: false }).day, '2026-11-05');
});

test('数える日：月の初めの深夜は、前の月の最後の日', () => {
  const now = new Date(2026, 11, 1, 0, 30); // 12月1日 0:30
  assert.equal(studyDay({ now, graceHour: 3, goal: 20, yesterdayAchieved: false }).day, '2026-11-30');
});

test('1問ずつ数えて、きょうのぶんに届いたら達成（その1問だけ achievedNow）', () => {
  let daily = emptyDaily;
  const log = [];
  for (let i = 0; i < 4; i++) {
    const result = addAnswer(daily, { grade: 'good', countsAsNew: i === 0, goal: 3 });
    daily = result.daily;
    log.push(result.achievedNow);
  }
  assert.deepEqual(log, [false, false, true, false]);
  assert.equal(daily.answered, 4);
  assert.equal(daily.good, 4);
  assert.equal(daily.newCount, 1);
  assert.equal(daily.goal, 3);
  assert.equal(isAchieved(daily), true);
});

test('達成したあとに問題数を上げても、スタンプは消えない・記録した問題数も変わらない', () => {
  const achieved = addAnswer({ ...emptyDaily, answered: 4 }, { grade: 'good', countsAsNew: false, goal: 5 }).daily;
  assert.equal(isAchieved(achieved), true);
  const later = addAnswer(achieved, { grade: 'again', countsAsNew: false, goal: 30 }).daily;
  assert.equal(isAchieved(later), true);
  assert.equal(later.goal, 5);
  assert.equal(recheckGoal(later, 50).daily.achieved, true);
});

test('問題数を下げて、もう届いていれば達成になる', () => {
  const daily = { ...emptyDaily, answered: 12, goal: 20 };
  const result = recheckGoal(daily, 10);
  assert.equal(result.achievedNow, true);
  assert.equal(isAchieved(result.daily), true);
  // 届いていなければそのまま（問題数だけ記録しなおす）
  const notYet = recheckGoal(daily, 15);
  assert.equal(notYet.achievedNow, false);
  assert.equal(notYet.daily.goal, 15);
  // 0 にしても達成にはならない
  assert.equal(recheckGoal(daily, 0).achievedNow, false);
});

test('全体のスタンプ：1冊でも達成で押す・2冊以上を全部達成で金色', () => {
  const date = '2026-11-05';
  assert.equal(makeOverallStamp(date, { achievedDeckIds: [], activeDeckIds: ['a', 'b'] }), null);
  const one = makeOverallStamp(date, { achievedDeckIds: ['a'], activeDeckIds: ['a', 'b'] });
  assert.deepEqual(one, { date, decks: ['a'], gold: false });
  const both = makeOverallStamp(date, { previous: one, achievedDeckIds: ['a', 'b'], activeDeckIds: ['a', 'b'] });
  assert.equal(both.gold, true);
  // 単語帳が1冊だけなら、金色にはならない
  assert.equal(makeOverallStamp(date, { achievedDeckIds: ['a'], activeDeckIds: ['a'] }).gold, false);
  // 一度金色になったら、あとで単語帳が増えても金色のまま
  const afterNewDeck = makeOverallStamp(date, { previous: both, achievedDeckIds: ['a', 'b'], activeDeckIds: ['a', 'b', 'c'] });
  assert.equal(afterNewDeck.gold, true);
});

test('連続日数：今日がまだでも昨日までつながっていれば数える', () => {
  const dates = new Set(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
  assert.equal(streakOf(dates, '2026-11-04'), 4);
  assert.equal(streakOf(dates, '2026-11-05'), 4);  // 今日はまだ → 昨日まで
  assert.equal(streakOf(dates, '2026-11-06'), 0);  // 昨日もやっていない → 切れた
  assert.equal(streakOf(new Set(['2026-11-05', '2026-11-03']), '2026-11-05'), 1);
});

test('連続日数：猶予の時間なら、昨日がまだでも一昨日までの連続を残す', () => {
  const dates = new Set(['2026-11-02', '2026-11-03']);
  assert.equal(streakOf(dates, '2026-11-05'), 0);
  assert.equal(streakOf(dates, '2026-11-05', { graceActive: true }), 2);
});

test('カレンダー：2026年11月は日曜はじまり・30日まで', () => {
  const weeks = monthWeeks(2026, 11);
  assert.equal(weeks[0][0], '2026-11-01');           // 11月1日は日曜
  assert.equal(weeks.flat().filter(Boolean).length, 30);
  assert.ok(weeks.every((week) => week.length === 7));
  const feb = monthWeeks(2027, 2);                    // 2027年2月1日は月曜
  assert.equal(feb[0][0], null);
  assert.equal(feb[0][1], '2027-02-01');
});

test('古い記録に達成の印を付けて、全体のスタンプを作り直す', () => {
  const decks = [{ id: 'a', dailyGoal: 10 }, { id: 'b', dailyGoal: 0 }];
  const daily = [
    { id: 'a:2026-11-03', deckId: 'a', date: '2026-11-03', answered: 12 },
    { id: 'a:2026-11-04', deckId: 'a', date: '2026-11-04', answered: 5 },
    { id: 'b:2026-11-04', deckId: 'b', date: '2026-11-04', answered: 30 },
    { id: 'a:2026-11-05', deckId: 'a', date: '2026-11-05', answered: 3, goal: 3, achieved: true }, // 新しい形はそのまま
  ];
  const result = rebuildStamps(decks, daily);
  assert.deepEqual(result.daily.map((d) => d.achieved), [true, false, false, true]);
  assert.equal(result.daily[0].goal, 10);
  assert.deepEqual(result.stamps, [
    { date: '2026-11-03', decks: ['a'], gold: false },
    { date: '2026-11-05', decks: ['a'], gold: false },
  ]);
});
