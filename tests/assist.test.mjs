// アイテム（ヒント・選択肢表示）のテスト
// 実行方法（vocabulary フォルダで）： node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schedule, nextLabel, newProgress, addDays } from '../js/srs.js';
import { hintOf } from '../js/quiz.js';
import { buyEntry, useEntry, walletOf, canBuy } from '../js/wallet.js';
import { addAnswer } from '../js/stamps.js';
import { ITEMS, ASSIST_INTERVAL } from '../js/defaults.js';

const TODAY = '2026-11-04';
const TOMORROW = addDays(TODAY, ASSIST_INTERVAL);
const card = { id: 'c1', deckId: 'd1', front: 'apple', back: 'りんご' };
const studied = (fields) => ({
  ...newProgress(card, 'f'), reps: 3, firstStudied: '2026-10-01', lastStudied: '2026-10-21', ...fields,
});

test('アイテムを使って正解：段階はそのまま、明日もう一度', () => {
  const before = studied({ level: 4, due: TODAY });
  for (const grade of ['good', 'choice']) {
    const after = schedule(before, grade, TODAY, { assisted: true });
    assert.equal(after.level, 4, grade);
    assert.equal(after.due, TOMORROW, grade);
    assert.equal(after.halfStep, false, grade);
    assert.equal(after.reps, 4, grade);
    assert.equal(after.lastResult, grade, grade);
  }
  assert.equal(nextLabel(before, 'good', TODAY, { assisted: true }), '明日');
  // 使っていなければ、いつもどおり段階が上がる
  assert.equal(schedule(before, 'good', TODAY).level, 5);
});

test('アイテムを使って「あやしい」：段階 −1（最低1）で明日。「忘れてた」はいつもと同じ', () => {
  const before = studied({ level: 4, due: TODAY });
  const hard = schedule(before, 'hard', TODAY, { assisted: true });
  assert.equal(hard.level, 3);
  assert.equal(hard.due, TOMORROW);
  const again = schedule(before, 'again', TODAY, { assisted: true });
  assert.deepEqual(again, schedule(before, 'again', TODAY));
  assert.equal(again.level, 0);
  assert.equal(again.due, TODAY);
});

test('新しい単語・前倒し・4択の半分でも、アイテムを使ったら明日', () => {
  const fresh = schedule(newProgress(card, 'f'), 'good', TODAY, { assisted: true });
  assert.equal(fresh.level, 0);
  assert.equal(fresh.due, TOMORROW);
  assert.equal(fresh.firstStudied, TODAY);

  // 前倒し（予定は10日後）でも、ヒントが必要だったなら明日に早める
  const early = schedule(studied({ level: 5, due: addDays(TODAY, 10) }), 'good', TODAY, { assisted: true });
  assert.equal(early.level, 5);
  assert.equal(early.due, TOMORROW);

  // 4択の半分（halfStep）は、アイテムを使うと消える
  const half = schedule(studied({ level: 2, due: TODAY, halfStep: true }), 'choice', TODAY, { assisted: true });
  assert.equal(half.level, 2);
  assert.equal(half.halfStep, false);
});

test('ヒント：最初の1文字だけ見せて、ほかは伏せる', () => {
  const apple = hintOf('apple');
  assert.equal(apple.letters, 5);
  assert.deepEqual(apple.cells.map((c) => c.type), ['open', 'blank', 'blank', 'blank', 'blank']);
  assert.equal(apple.cells[0].ch, 'a');
  // 伏せた文字の中身は持たない
  assert.ok(apple.cells.slice(1).every((c) => c.ch === ''));

  const takeOff = hintOf('  take off ');
  assert.equal(takeOff.letters, 7);
  assert.deepEqual(takeOff.cells.map((c) => c.type),
    ['open', 'blank', 'blank', 'blank', 'space', 'blank', 'blank', 'blank']);
});

test('ヒント：区切りやかっこはそのまま見せる（日本語も）', () => {
  const ja = hintOf('走る、走らせる');
  assert.equal(ja.letters, 6);
  assert.equal(ja.cells[0].ch, '走');
  assert.deepEqual(ja.cells.map((c) => c.type), ['open', 'blank', 'mark', 'blank', 'blank', 'blank', 'blank']);
  assert.equal(ja.cells[2].ch, '、');

  const paren = hintOf('run (fast)');
  assert.equal(paren.letters, 7);
  assert.deepEqual(paren.cells.filter((c) => c.type === 'mark').map((c) => c.ch), ['(', ')']);

  // 記号から始まっても、最初の「文字」を見せる
  const quoted = hintOf('「はい」');
  assert.equal(quoted.cells.find((c) => c.type === 'open').ch, 'は');

  assert.deepEqual(hintOf(''), { cells: [], letters: 0 });
});

test('ヒント・選択肢表示：交換して使うと減る（お休みの日にはならない）', () => {
  const entries = [
    { id: 'goal:x', type: 'goal', coins: 20, at: 1 },
    buyEntry('hint', 'a', 2),
    buyEntry('hint', 'b', 3),
    buyEntry('choices', 'c', 4),
    useEntry('hint', 'd', { cardId: 'c1', date: TODAY }, 5),
  ];
  const wallet = walletOf(entries);
  assert.equal(wallet.coins, 20 - ITEMS.hint.price * 2 - ITEMS.choices.price);
  assert.equal(wallet.items.hint, 1);
  assert.equal(wallet.items.choices, 1);
  assert.equal(wallet.items.rest, 0);
  assert.equal(wallet.restDates.size, 0);
  assert.deepEqual(useEntry('hint', 'd', { cardId: 'c1', date: TODAY }, 5), {
    id: 'use:d', type: 'use', item: 'hint', count: -1, coins: 0, cardId: 'c1', date: TODAY, at: 5,
  });
});

test('ヒント・選択肢表示の値段と持てる数', () => {
  const empty = walletOf([]);
  assert.deepEqual(Object.keys(empty.items).sort(), ['choices', 'hint', 'rest']);
  const rich = { coins: 999, items: { hint: ITEMS.hint.max, choices: 0, rest: 0 } };
  assert.equal(canBuy(rich, 'hint').ok, false);
  assert.equal(canBuy(rich, 'choices').ok, true);
  const poor = { coins: ITEMS.choices.price - 1, items: { hint: 0, choices: 0, rest: 0 } };
  assert.match(canBuy(poor, 'choices').reason, /あと 🪙1/);
});

test('日ごとの記録：アイテムを使った問題を数える', () => {
  const base = { id: 'd1:2026-11-04', deckId: 'd1', date: TODAY, answered: 0, newCount: 0, good: 0, hard: 0, again: 0, choice: 0 };
  const first = addAnswer(base, { grade: 'good', countsAsNew: false, goal: 10, assisted: true }).daily;
  assert.equal(first.assisted, 1);
  assert.equal(first.good, 1);
  const second = addAnswer(first, { grade: 'choice', countsAsNew: false, goal: 10, assisted: true }).daily;
  assert.equal(second.assisted, 2);
  assert.equal(second.choice, 1);
  const third = addAnswer(second, { grade: 'good', countsAsNew: false, goal: 10 }).daily;
  assert.equal(third.assisted, 2);
  assert.equal(third.answered, 3);
});
