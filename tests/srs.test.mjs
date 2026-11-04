// 間隔反復のテスト
// 実行方法（vocabulary フォルダで）： node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  schedule, nextLabel, buildQueue, countAvailable, newProgress, addDays, daysBetween, progressId, MAX_LEVEL,
} from '../js/srs.js';

const TODAY = '2026-11-04';
const card = (id, deckId = 'd1') => ({ id, deckId, front: id, back: id.toUpperCase() });
const studied = (c, dir, fields) => ({ ...newProgress(c, dir), reps: 1, firstStudied: '2026-11-01', lastStudied: '2026-11-01', ...fields });

test('日付の計算（月またぎ・年またぎ）', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(daysBetween('2026-11-04', '2026-12-04'), 30);
});

test('新しい単語：覚えてた → 段階1・明日', () => {
  const p = schedule(newProgress(card('a'), 'f'), 'good', TODAY);
  assert.equal(p.level, 1);
  assert.equal(p.due, '2026-11-05');
  assert.equal(p.reps, 1);
  assert.equal(p.firstStudied, TODAY);
  assert.equal(p.lastStudied, TODAY);
});

test('覚えてた → 段階が上がり、間隔が延びる（上限は段階7）', () => {
  const c = card('a');
  assert.equal(schedule(studied(c, 'f', { level: 2, due: TODAY }), 'good', TODAY).due, addDays(TODAY, 7));
  const top = schedule(studied(c, 'f', { level: MAX_LEVEL, due: TODAY }), 'good', TODAY);
  assert.equal(top.level, MAX_LEVEL);
  assert.equal(top.due, addDays(TODAY, 120));
});

test('あやしい → 段階が1つ下がる（最低1）', () => {
  const c = card('a');
  const p = schedule(studied(c, 'f', { level: 4, due: TODAY }), 'hard', TODAY);
  assert.equal(p.level, 3);
  assert.equal(p.due, addDays(TODAY, 7));
  assert.equal(schedule(newProgress(c, 'f'), 'hard', TODAY).level, 1);
});

test('忘れてた → 段階0・今日もう一度。覚えていた単語なら「忘れた回数」が増える', () => {
  const c = card('a');
  const p = schedule(studied(c, 'f', { level: 3, due: TODAY }), 'again', TODAY);
  assert.equal(p.level, 0);
  assert.equal(p.due, TODAY);
  assert.equal(p.lapses, 1);
  // 新しい単語を忘れても、「忘れた回数」は増えない
  assert.equal(schedule(newProgress(c, 'f'), 'again', TODAY).lapses, 0);
});

test('前倒しで「覚えてた」なら記録は変わらない', () => {
  const c = card('a');
  const before = studied(c, 'f', { level: 2, due: '2026-11-06' });
  const after = schedule(before, 'good', TODAY);
  assert.equal(after.level, 2);
  assert.equal(after.due, '2026-11-06');
  assert.equal(nextLabel(before, 'good', TODAY), 'そのまま');
});

test('ボタンの下の言葉', () => {
  const c = card('a');
  const p = studied(c, 'f', { level: 1, due: TODAY });
  assert.equal(nextLabel(p, 'again', TODAY), 'もう一度');
  assert.equal(nextLabel(p, 'hard', TODAY), '明日');
  assert.equal(nextLabel(p, 'good', TODAY), '3日後');
  assert.equal(nextLabel(studied(c, 'f', { level: 5, due: TODAY }), 'good', TODAY), '約2か月後');
});

test('出題の順番：復習（苦手から）→ 新しい単語（上限まで）→ 前倒し', () => {
  const cards = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => card(id));
  const [a, b, c] = cards;
  const progressList = [
    studied(a, 'f', { level: 3, due: '2026-11-03' }),
    studied(b, 'f', { level: 1, due: TODAY }),
    studied(c, 'f', { level: 2, due: '2026-11-08' }), // まだ先
  ];
  const queue = buildQueue({ cards, progressList, directions: 'forward', today: TODAY, newLimit: 2, size: 10 });
  assert.deepEqual(queue.map((i) => `${i.card.id}:${i.kind}`), ['b:due', 'a:due', 'd:new', 'e:new', 'c:early']);
});

test('問題数の上限（size）を守る', () => {
  const cards = ['a', 'b', 'c'].map((id) => card(id));
  const queue = buildQueue({ cards, progressList: [], directions: 'forward', today: TODAY, newLimit: 10, size: 2 });
  assert.equal(queue.length, 2);
});

test('両方向：新しい単語はまず表→裏だけ。裏→表は次の日から', () => {
  const [a, b] = [card('a'), card('b')];
  // a は昨日 表→裏 をやった、b はまだ何もしていない
  const progressList = [studied(a, 'f', { level: 1, due: '2026-11-05', firstStudied: '2026-11-03', lastStudied: '2026-11-03' })];
  const queue = buildQueue({ cards: [a, b], progressList, directions: 'both', today: TODAY, newLimit: 10, size: 10 });
  assert.deepEqual(queue.map((i) => `${i.card.id}:${i.dir}:${i.kind}`), ['a:b:reverse', 'b:f:new']);
});

test('今日はじめて表→裏をやった単語の裏→表は、今日は新しく出さない', () => {
  const a = card('a');
  const progressList = [studied(a, 'f', { level: 1, due: '2026-11-05', firstStudied: TODAY, lastStudied: TODAY })];
  const queue = buildQueue({ cards: [a], progressList, directions: 'both', today: TODAY, newLimit: 10, size: 10 });
  assert.deepEqual(queue.map((i) => `${i.dir}:${i.kind}`), ['f:extra']);
});

test('同じ単語の両方向が復習日でも、1回の学習では片方だけ', () => {
  const a = card('a');
  const progressList = [
    studied(a, 'f', { level: 2, due: TODAY }),
    studied(a, 'b', { level: 1, due: TODAY }),
  ];
  const queue = buildQueue({ cards: [a], progressList, directions: 'both', today: TODAY, newLimit: 10, size: 10 });
  assert.equal(queue.length, 1);
  assert.equal(queue[0].dir, 'b'); // 段階が低い（苦手な）ほう
});

test('ホーム用の数：復習の数と新しく出せる数', () => {
  const cards = ['a', 'b', 'c', 'd'].map((id) => card(id));
  const progressList = [studied(cards[0], 'f', { level: 1, due: TODAY })];
  const counts = countAvailable({ cards, progressList, directions: 'forward', today: TODAY, newLimit: 2 });
  assert.deepEqual(counts, { due: 1, fresh: 2 });
  assert.equal(progressId('x', 'f'), 'x:f');
});

test('4択の正解は半分の重さ：1回目は段階そのまま、2回目で段階 +1', () => {
  const c = card('a');
  // 新しい単語を4択で正解 → 段階0のまま「半分」たまる・明日もう一度
  const first = schedule(newProgress(c, 'f'), 'choice', TODAY);
  assert.equal(first.level, 0);
  assert.equal(first.halfStep, true);
  assert.equal(first.due, addDays(TODAY, 1));
  // 次の日にまた4択で正解 → 段階1
  const day2 = addDays(TODAY, 1);
  const second = schedule(first, 'choice', day2);
  assert.equal(second.level, 1);
  assert.equal(second.halfStep, false);
  assert.equal(second.due, addDays(day2, 1));
  // 段階3（7日）で4択の正解1回目 → 段階3のまま、また7日後
  const p = studied(c, 'f', { level: 3, due: TODAY });
  const half = schedule(p, 'choice', TODAY);
  assert.equal(half.level, 3);
  assert.equal(half.due, addDays(TODAY, 7));
  assert.equal(nextLabel(p, 'choice', TODAY), '7日後');
});

test('4択の「半分」は、ほかの答え方をすると消える', () => {
  const c = card('a');
  const p = studied(c, 'f', { level: 2, due: TODAY, halfStep: true });
  // 覚えてた → ふつうに +1（半分は使わずに消える）
  assert.equal(schedule(p, 'good', TODAY).level, 3);
  assert.equal(schedule(p, 'good', TODAY).halfStep, false);
  // 忘れてた → 段階0・半分も消える
  assert.equal(schedule(p, 'again', TODAY).halfStep, false);
  // 前倒しの4択の正解では何も変わらない
  const early = studied(c, 'f', { level: 2, due: '2026-11-06', halfStep: true });
  const after = schedule(early, 'choice', TODAY);
  assert.equal(after.level, 2);
  assert.equal(after.halfStep, true);
  assert.equal(after.due, '2026-11-06');
});

test('前から保存されている記録（halfStep がない）でも4択の正解を数えられる', () => {
  const c = card('a');
  const old = studied(c, 'f', { level: 1, due: TODAY });
  delete old.halfStep;
  const p = schedule(old, 'choice', TODAY);
  assert.equal(p.level, 1);
  assert.equal(p.halfStep, true);
});
