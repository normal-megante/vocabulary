// コインとアイテムのテスト
// 実行方法（vocabulary フォルダで）： node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  goalEntry, goldEntry, buyEntry, restEntry, walletOf, canBuy, planRestDays, rebuildWallet,
} from '../js/wallet.js';
import { COIN_REWARDS, ITEMS } from '../js/defaults.js';

const price = ITEMS.rest.price;

test('通帳を足して、コインとアイテムの数を出す', () => {
  const entries = [
    goalEntry('a', '2026-11-01', 1),
    goalEntry('b', '2026-11-01', 1),
    goldEntry('2026-11-01', 1),
    { ...goalEntry('a', '2026-11-02', 1), coins: 100 },
    buyEntry('rest', 'x1', 2),
    restEntry('2026-11-03', 3),
  ];
  const wallet = walletOf(entries);
  assert.equal(wallet.coins, COIN_REWARDS.goal * 2 + COIN_REWARDS.goldBonus + 100 - price);
  assert.equal(wallet.items.rest, 0); // 1枚買って、1枚使った
  assert.deepEqual([...wallet.restDates], ['2026-11-03']);
  assert.deepEqual(walletOf([]), {
    coins: 0, items: { rest: 0, hint: 0, choices: 0 }, restDates: new Set(), trophies: 0,
  });
  assert.equal(walletOf([{ id: 'trophy:stamp1', type: 'trophy', trophy: 'stamp1', coins: 5 }]).trophies, 1);
});

test('同じ日・同じ単語帳のコインは、同じ id になる（2回もらえない）', () => {
  assert.equal(goalEntry('a', '2026-11-01').id, goalEntry('a', '2026-11-01').id);
  assert.notEqual(goalEntry('a', '2026-11-01').id, goalEntry('b', '2026-11-01').id);
  assert.equal(goldEntry('2026-11-01').id, 'gold:2026-11-01');
  assert.equal(restEntry('2026-11-03').id, 'rest:2026-11-03');
});

test('交換できるか：コインが足りない・持てる数がいっぱい', () => {
  assert.deepEqual(canBuy({ coins: price, items: { rest: 0 } }, 'rest'), { ok: true, reason: '' });
  const short = canBuy({ coins: price - 8, items: { rest: 0 } }, 'rest');
  assert.equal(short.ok, false);
  assert.match(short.reason, /あと 🪙8/);
  const full = canBuy({ coins: 999, items: { rest: ITEMS.rest.max } }, 'rest');
  assert.equal(full.ok, false);
  assert.match(full.reason, /いっぱい/);
  assert.equal(canBuy({ coins: 999, items: {} }, 'nothing').ok, false);
});

test('お休みチケット：きのう抜けたら、1枚使ってつなぐ', () => {
  const streakDates = new Set(['2026-11-02', '2026-11-03']);
  assert.deepEqual(planRestDays({ streakDates, tickets: 1, today: '2026-11-05' }), ['2026-11-04']);
  // チケットがなければ使わない
  assert.deepEqual(planRestDays({ streakDates, tickets: 0, today: '2026-11-05' }), []);
});

test('お休みチケット：きのうまで続いている・今日やった なら使わない', () => {
  const streakDates = new Set(['2026-11-03', '2026-11-04']);
  assert.deepEqual(planRestDays({ streakDates, tickets: 3, today: '2026-11-05' }), []);
  assert.deepEqual(planRestDays({ streakDates: new Set(['2026-11-05']), tickets: 3, today: '2026-11-05' }), []);
});

test('お休みチケット：2日抜けたら2枚。足りなければ使わずに残す', () => {
  const streakDates = new Set(['2026-11-02']);
  assert.deepEqual(planRestDays({ streakDates, tickets: 2, today: '2026-11-05' }), ['2026-11-03', '2026-11-04']);
  assert.deepEqual(planRestDays({ streakDates, tickets: 1, today: '2026-11-05' }), []);
});

test('お休みチケット：猶予の時間は、きのうの分がまだできるので、きのうには使わない', () => {
  const streakDates = new Set(['2026-11-03']);
  assert.deepEqual(planRestDays({ streakDates, tickets: 3, today: '2026-11-05', graceActive: true }), []);
  // おとといも抜けていたら、おとといの分だけ使う
  const older = new Set(['2026-11-02']);
  assert.deepEqual(planRestDays({ streakDates: older, tickets: 3, today: '2026-11-05', graceActive: true }), ['2026-11-03']);
});

test('お休みチケット：スタンプが1つもなければ使わない・月をまたいでも数えられる', () => {
  assert.deepEqual(planRestDays({ streakDates: new Set(), tickets: 3, today: '2026-11-05' }), []);
  assert.deepEqual(planRestDays({ streakDates: new Set(['2026-10-30']), tickets: 3, today: '2026-11-02' }),
    ['2026-10-31', '2026-11-01']);
});

test('これまでのスタンプの分のコインを、通帳に記録する', () => {
  const daily = [
    { deckId: 'a', date: '2026-11-01', achieved: true },
    { deckId: 'b', date: '2026-11-01', achieved: true },
    { deckId: 'a', date: '2026-11-02', achieved: false },
    { deckId: 'a', date: '2026-11-03' },
  ];
  const stamps = [
    { date: '2026-11-01', decks: ['a', 'b'], gold: true },
    { date: '2026-11-03', decks: ['a'], gold: false },
  ];
  const entries = rebuildWallet(daily, stamps);
  assert.deepEqual(entries.map((e) => e.id), ['goal:a:2026-11-01', 'goal:b:2026-11-01', 'gold:2026-11-01']);
  assert.equal(walletOf(entries).coins, COIN_REWARDS.goal * 2 + COIN_REWARDS.goldBonus);
});
