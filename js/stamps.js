// =========================================================
// きょうのぶん・スタンプの計算
//
// ・数える日：夜中の0時〜猶予時刻（初期値 午前3時）に学習したとき、
//   その単語帳の前の日の「きょうのぶん」がまだ達成されていなければ、前の日の分として数える。
//   前の日が達成されたら、それ以降は今日の分として数える。
// ・単語帳ごとのスタンプ：その日の「きょうのぶん」を達成したら1つ（daily.achieved）。
//   一度押したスタンプは、あとで問題数の設定を変えても消えない。
// ・全体のスタンプ：どれか1つの単語帳でも達成した日に1つ（stamps 棚）。
//   単語帳が2冊以上あって、全部を達成した日は金色。
//
// 画面やデータ保存とは関係のない「計算だけ」のファイル。
// tests/stamps.test.mjs で動きを確かめられる。
// =========================================================
import { toDateKey } from './util.js';
import { addDays } from './srs.js';
import { DECK_DEFAULTS } from './defaults.js';

// 金色のスタンプになるのに必要な単語帳の数（1冊だけだと毎回金色になってしまうため）
export const GOLD_MIN_DECKS = 2;

// ---------------------------------------------------------
// 数える日
//   now               : いまの日時
//   graceHour         : 猶予時刻（3 なら 0:00〜2:59 が猶予の時間。0 なら猶予なし）
//   goal              : その単語帳の「きょうのぶん」の問題数（0 ならスタンプの対象外なので猶予なし）
//   yesterdayAchieved : 前の日の「きょうのぶん」を達成ずみか
//   → { day: 数える日（'2026-11-04' の形）, late: 前の日の分として数えているか }
// ---------------------------------------------------------
export function studyDay({ now = new Date(), graceHour, goal, yesterdayAchieved }) {
  const today = toDateKey(now);
  if (inGrace(now, graceHour) && goal > 0 && !yesterdayAchieved) {
    return { day: addDays(today, -1), late: true };
  }
  return { day: today, late: false };
}

// いまが猶予の時間（夜中の0時〜猶予時刻）か
export function inGrace(now, graceHour) {
  return now.getHours() < graceHour;
}

// その日の「きょうのぶん」を達成したか
export function isAchieved(daily) {
  return daily?.achieved === true;
}

// ---------------------------------------------------------
// 日ごとの記録（daily）
// ---------------------------------------------------------

// まだ達成していなければ、いまの問題数（goal）を記録して、届いていれば達成にする
// （達成したあとは goal も変えない ＝ そのときの問題数が残る）
function checkGoal(daily, goal) {
  if (isAchieved(daily)) return { daily, achievedNow: false };
  const next = { ...daily, goal };
  const achievedNow = goal > 0 && next.answered >= goal;
  if (achievedNow) next.achieved = true;
  return { daily: next, achievedNow };
}

// 1問答えたときの記録の更新
//   assisted : ヒント・選択肢表示を使って答えたか（使った問題の数を assisted に数える）
//   → { daily: 新しい記録, achievedNow: この1問で達成したか }
export function addAnswer(daily, { grade, countsAsNew, goal, assisted = false }) {
  const next = {
    ...daily,
    answered: (daily.answered ?? 0) + 1,
    [grade]: (daily[grade] ?? 0) + 1,
    newCount: (daily.newCount ?? 0) + (countsAsNew ? 1 : 0),
  };
  if (assisted) next.assisted = (daily.assisted ?? 0) + 1;
  return checkGoal(next, goal);
}

// 問題数の設定を変えたとき：もう届いていれば達成にする（届かなくなっても、達成は取り消さない）
export function recheckGoal(daily, goal) {
  return checkGoal(daily, goal);
}

// ---------------------------------------------------------
// 全体のスタンプ（stamps 棚の1日分：{ date, decks: [達成した単語帳の ID], gold }）
//   previous        : いままでのその日の全体スタンプ（なければ null）
//   achievedDeckIds : その日に達成した単語帳
//   activeDeckIds   : いま対象の単語帳（きょうのぶんが1問以上で、単語が入っているもの）
//   → 新しい全体スタンプ（どれも達成していなければ null）
// 一度押したスタンプ・金色は、消えない。
// ---------------------------------------------------------
export function makeOverallStamp(date, { previous = null, achievedDeckIds, activeDeckIds }) {
  const decks = [...new Set([...(previous?.decks ?? []), ...achievedDeckIds])];
  if (decks.length === 0) return null;
  const allDone = activeDeckIds.length >= GOLD_MIN_DECKS && activeDeckIds.every((id) => decks.includes(id));
  return { date, decks, gold: Boolean(previous?.gold) || allDone };
}

// ---------------------------------------------------------
// 連続して達成した日数
//   dates       : 達成した日の Set
//   today       : 今日の日付
//   graceActive : いまが猶予の時間か（昨日の分がまだ達成できるので、昨日が未達成でも連続を切らない）
// 今日がまだでも、昨日まで続いていれば連続は切れていない（今日やればつながる）。
// ---------------------------------------------------------
export function streakOf(dates, today, { graceActive = false } = {}) {
  let day = today;
  if (!dates.has(day)) {
    day = addDays(day, -1);
    if (!dates.has(day) && graceActive) day = addDays(day, -1);
  }
  let count = 0;
  while (dates.has(day)) {
    count++;
    day = addDays(day, -1);
  }
  return count;
}

// ---------------------------------------------------------
// カレンダー：その月の日付を週ごとに並べる（日曜はじまり。月の外は null）
//   month は 1〜12
// ---------------------------------------------------------
export function monthWeeks(year, month) {
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const days = new Date(year, month, 0).getDate();
  const cells = Array(firstWeekday).fill(null);
  for (let d = 1; d <= days; d++) cells.push(toDateKey(new Date(year, month - 1, d)));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// ---------------------------------------------------------
// 達成の印がない古い記録（ステップ6までのデータ・古いバックアップ）に印を付け、
// 全体のスタンプを作り直す。いまの単語帳の問題数で判定する。
//   → { daily: 印を付けた記録, stamps: 全体のスタンプ }
// ---------------------------------------------------------
export function rebuildStamps(decks, dailyList) {
  const goals = new Map(decks.map((deck) => [deck.id, deck.dailyGoal ?? DECK_DEFAULTS.dailyGoal]));
  const byDate = new Map();
  const daily = dailyList.map((record) => {
    let next = record;
    if (record.achieved === undefined) {
      const goal = goals.get(record.deckId) ?? DECK_DEFAULTS.dailyGoal;
      next = { ...record, goal, achieved: goal > 0 && (record.answered ?? 0) >= goal };
    }
    if (isAchieved(next)) {
      if (!byDate.has(next.date)) byDate.set(next.date, []);
      byDate.get(next.date).push(next.deckId);
    }
    return next;
  });
  const stamps = [...byDate.keys()].sort().map((date) => ({ date, decks: byDate.get(date), gold: false }));
  return { daily, stamps };
}
