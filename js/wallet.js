// =========================================================
// コインとアイテムの計算
//
// コインやアイテムの出し入れは、すべて「通帳」（wallet 棚）に1行ずつ記録する。
//   { id, type, coins（増えたコイン。使ったときはマイナス）, item, count（増えたアイテムの数）, date, at（記録した時刻） }
//   type：'goal' … 単語帳の「きょうのぶん」を達成（id ＝ 'goal:単語帳ID:日付'）
//         'gold' … 金色のスタンプのボーナス（id ＝ 'gold:日付'）
//         'buy'  … コインでアイテムと交換（id ＝ 'buy:ランダムな文字'）
//         'use'  … アイテムを使った（お休みチケットは id ＝ 'rest:お休みにした日'、
//                  ヒント・選択肢表示は id ＝ 'use:ランダムな文字'）
//         'bingo'  … スタンプカードのビンゴ（bingo.js。id ＝ 'bingo:2026-11:row1' など）
//         'trophy' … トロフィー（trophies.js。id ＝ 'trophy:streak3' など）
// ・同じ id は1回しか記録されないので、同じ日に同じ単語帳で2回コインをもらうことはない。
// ・単語帳を消しても通帳は消さない（もらったコインは減らない）。
// ・いまのコインや持っているアイテムの数は、通帳を全部足して出す。
//
// 画面やデータ保存とは関係のない「計算だけ」のファイル。
// tests/wallet.test.mjs で動きを確かめられる。
// =========================================================
import { COIN_REWARDS, ITEMS } from './defaults.js';
import { addDays } from './srs.js';
import { isAchieved } from './stamps.js';

// ---- 通帳の1行を作る ----
export function goalEntry(deckId, date, at = Date.now()) {
  return { id: `goal:${deckId}:${date}`, type: 'goal', deckId, date, coins: COIN_REWARDS.goal, at };
}

export function goldEntry(date, at = Date.now()) {
  return { id: `gold:${date}`, type: 'gold', date, coins: COIN_REWARDS.goldBonus, at };
}

export function buyEntry(itemKey, uniqueId, at = Date.now()) {
  return { id: `buy:${uniqueId}`, type: 'buy', item: itemKey, count: 1, coins: -ITEMS[itemKey].price, at };
}

export function restEntry(date, at = Date.now()) {
  return { id: `rest:${date}`, type: 'use', item: 'rest', count: -1, date, coins: 0, at };
}

// 学習中にアイテム（ヒント・選択肢表示）を使った（cardId：どの単語で使ったか）
export function useEntry(itemKey, uniqueId, { cardId = null, date = null } = {}, at = Date.now()) {
  return { id: `use:${uniqueId}`, type: 'use', item: itemKey, count: -1, coins: 0, cardId, date, at };
}

// ---------------------------------------------------------
// 通帳から、いまのようすを出す
//   → { coins: コインの枚数, items: { rest: 持っている数, ... }, restDates: お休みにした日の Set,
//       trophies: 取ったトロフィーの数 }
// ---------------------------------------------------------
export function walletOf(entries) {
  let coins = 0;
  let trophies = 0;
  const items = Object.fromEntries(Object.keys(ITEMS).map((key) => [key, 0]));
  const restDates = new Set();
  for (const entry of entries) {
    coins += entry.coins ?? 0;
    if (entry.item) items[entry.item] = (items[entry.item] ?? 0) + (entry.count ?? 0);
    if (entry.type === 'use' && entry.item === 'rest') restDates.add(entry.date);
    if (entry.type === 'trophy') trophies++;
  }
  return { coins, items, restDates, trophies };
}

// ---------------------------------------------------------
// アイテムと交換できるか
//   → { ok: できるか, reason: できないときの理由（画面に出す言葉） }
// ---------------------------------------------------------
export function canBuy(wallet, itemKey) {
  const item = ITEMS[itemKey];
  if (!item) return { ok: false, reason: 'そのアイテムはありません' };
  if ((wallet.items[itemKey] ?? 0) >= item.max) {
    return { ok: false, reason: `${item.max}${item.unit}まで持てます（いっぱいです）` };
  }
  if (wallet.coins < item.price) {
    return { ok: false, reason: `あと 🪙${item.price - wallet.coins} で交換できます` };
  }
  return { ok: true, reason: '' };
}

// ---------------------------------------------------------
// お休みチケットを使う日を決める
//   streakDates : スタンプかお休みのある日の Set（全体）
//   tickets     : 持っているお休みチケットの数
//   today       : 今日の日付
//   graceActive : いまが猶予の時間か（昨日の分はまだ達成できるので、昨日は「終わった日」にしない）
//   → チケットを使う日の一覧（使わないときは []）
// 最後にスタンプ（かお休み）があった日から、終わった日までのすき間を、全部うめられるときだけ使う。
// うめきれない（チケットが足りない）ときは、どのみち連続は切れるので、チケットは残しておく。
// ---------------------------------------------------------
export function planRestDays({ streakDates, tickets, today, graceActive = false }) {
  if (tickets <= 0 || streakDates.size === 0) return [];
  const lastClosed = addDays(today, graceActive ? -2 : -1);
  const latest = [...streakDates].sort().pop();
  if (latest >= lastClosed) return [];

  const gap = [];
  for (let day = addDays(latest, 1); day <= lastClosed; day = addDays(day, 1)) {
    gap.push(day);
    if (gap.length > tickets) return [];
  }
  return gap;
}

// ---------------------------------------------------------
// 通帳がないとき（ステップ7までのデータ・古いバックアップ）に、
// これまでのスタンプの分のコインを記録した通帳を作る
//   → 通帳の行の一覧
// ---------------------------------------------------------
export function rebuildWallet(dailyList, stamps, at = null) {
  return [
    ...dailyList.filter(isAchieved).map((daily) => goalEntry(daily.deckId, daily.date, at)),
    ...stamps.filter((stamp) => stamp.gold).map((stamp) => goldEntry(stamp.date, at)),
  ];
}
