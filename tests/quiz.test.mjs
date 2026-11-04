// 4択・入力のテスト
// 実行方法（vocabulary フォルダで）： node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChoices, canUseChoice, checkTyped, acceptedAnswers, pickFormat, shuffle, answerOf, CHOICE_COUNT,
} from '../js/quiz.js';

const card = (id, front, back) => ({ id, deckId: 'd1', front, back, example: '', note: '' });
const deck = [
  card('1', 'apple', 'りんご'),
  card('2', 'run', '走る'),
  card('3', 'book', '本'),
  card('4', 'cat', 'ねこ'),
  card('5', 'dog', '犬'),
];

// いつも同じ順番になる「さいころ」（テストの結果が毎回同じになるように）
function fixedRandom(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

test('4択：正解1つとハズレ3つ、全部ちがう答え', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const result = buildChoices(deck[0], 'f', deck, fixedRandom(seed));
    assert.equal(result.options.length, CHOICE_COUNT);
    assert.equal(result.options[result.correctIndex], 'りんご');
    assert.equal(new Set(result.options).size, CHOICE_COUNT);
  }
  // 裏→表なら、選択肢は表の言葉
  const reverse = buildChoices(deck[1], 'b', deck, fixedRandom(3));
  assert.equal(reverse.options[reverse.correctIndex], 'run');
  assert.ok(reverse.options.every((text) => deck.some((c) => c.front === text)));
});

test('4択：正解と同じに見える答えはハズレに使わない', () => {
  const cards = [
    card('1', 'big', '大きい'),
    card('2', 'large', '大きい'),  // 正解と同じ答え → 使わない
    card('3', 'small', 'ちいさい'),
    card('4', 'tall', '高い'),
  ];
  // ハズレが2つしか作れないので、4択にできない
  assert.equal(buildChoices(cards[0], 'f', cards), null);
  assert.equal(canUseChoice(cards, 'forward'), false);
  // 表の言葉はみんなちがうので、裏→表なら4択にできる
  assert.equal(canUseChoice(cards, 'both'), true);
  assert.ok(buildChoices(cards[0], 'b', cards));
});

test('4択：単語が4語未満なら使えない', () => {
  assert.equal(canUseChoice(deck.slice(0, 3), 'both'), false);
  assert.equal(canUseChoice(deck.slice(0, 4), 'both'), true);
});

test('入力：大文字小文字・全角半角・前後の空白・最後の「.」は気にしない', () => {
  assert.equal(checkTyped('Apple', 'apple'), true);
  assert.equal(checkTyped('  ａｐｐｌｅ ', 'apple'), true);
  assert.equal(checkTyped('I ate an apple', 'I ate an apple.'), true);
  assert.equal(checkTyped("don’t", "don't"), true);
  assert.equal(checkTyped('ネコ', 'ねこ'), true);
  assert.equal(checkTyped('りんご', 'リンゴ'), true);
  assert.equal(checkTyped('コーヒー', 'コーヒー'), true);
  assert.equal(checkTyped('aple', 'apple'), false);
  assert.equal(checkTyped('', 'apple'), false);
  assert.equal(checkTyped('   ', 'apple'), false);
});

test('入力：「、」や「/」で区切ってあれば、どれか1つでよい', () => {
  assert.equal(checkTyped('走る', '走る、走らせる'), true);
  assert.equal(checkTyped('走らせる', '走る、走らせる'), true);
  assert.equal(checkTyped('走る、走らせる', '走る、走らせる'), true);
  assert.equal(checkTyped('dash', 'run / dash'), true);
  assert.equal(checkTyped('走', '走る、走らせる'), false);
});

test('入力：かっこの中は書かなくてもよい', () => {
  assert.equal(checkTyped('走る', '走る（速く）'), true);
  assert.equal(checkTyped('走る（速く）', '走る（速く）'), true);
  assert.equal(checkTyped('run', 'run (fast)'), true);
  assert.deepEqual(acceptedAnswers('本'), ['本']);
});

test('出し方：おまかせは3種類から、4択が作れない問題はめくるで', () => {
  const random = fixedRandom(7);
  const seen = new Set();
  for (let i = 0; i < 60; i++) seen.add(pickFormat('auto', true, random));
  assert.deepEqual([...seen].sort(), ['choice', 'flip', 'type']);
  for (let i = 0; i < 30; i++) assert.notEqual(pickFormat('auto', false, random), 'choice');
  assert.equal(pickFormat('choice', false), 'flip');
  assert.equal(pickFormat('choice', true), 'choice');
  assert.equal(pickFormat('type', false), 'type');
});

test('並べ替えても中身は同じで、元の並びは変わらない', () => {
  const list = [1, 2, 3, 4, 5];
  const result = shuffle(list, fixedRandom(5));
  assert.deepEqual([...result].sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual(list, [1, 2, 3, 4, 5]);
  assert.equal(answerOf(deck[0], 'b'), 'apple');
});
