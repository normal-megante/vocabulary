// バックアップのテスト
// 実行方法（vocabulary フォルダで）： node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBackup, parseBackup, backupFileName, BACKUP_FORMAT } from '../js/backup.js';

const sampleData = {
  decks: [{ id: 'd1', name: '英単語', createdAt: 1 }],
  cards: [
    { id: 'c1', deckId: 'd1', front: 'apple', back: 'りんご', example: '', note: '' },
    { id: 'c2', deckId: 'd1', front: 'book', back: '本', example: '', note: '' },
  ],
  progress: [{ id: 'c1:f', cardId: 'c1', deckId: 'd1', dir: 'f', level: 1, due: '2026-11-05', reps: 1 }],
  daily: [{ id: 'd1:2026-11-04', deckId: 'd1', date: '2026-11-04', answered: 3, newCount: 1 }],
  stamps: [{ date: '2026-11-04', decks: ['d1'], gold: false }],
  wallet: [
    { id: 'goal:d1:2026-11-04', type: 'goal', deckId: 'd1', date: '2026-11-04', coins: 3, at: 1 },
    { id: 'buy:x1', type: 'buy', item: 'rest', count: 1, coins: -20, at: 2 },
  ],
  settings: [{ key: 'app', value: { graceHour: 3 } }],
};

test('書き出したものを、そのまま読み込める', () => {
  const backup = makeBackup(sampleData, { appVersion: 'test', exportedAt: '2026-11-04T12:00:00.000Z' });
  const result = parseBackup(JSON.stringify(backup));
  assert.equal(result.ok, true);
  assert.deepEqual(result.backup.data, sampleData);
  assert.deepEqual(result.summary, { decks: 1, cards: 2, exportedAt: '2026-11-04T12:00:00.000Z' });
  assert.equal(result.backup.format, BACKUP_FORMAT);
});

test('空のデータでも書き出し・読み込みできる', () => {
  const result = parseBackup(JSON.stringify(makeBackup({}, { appVersion: 'test' })));
  assert.equal(result.ok, true);
  assert.equal(result.summary.cards, 0);
});

test('JSON ではないファイルは断る', () => {
  const result = parseBackup('apple\tりんご');
  assert.equal(result.ok, false);
  assert.match(result.error, /読み取れません/);
});

test('ほかのアプリの JSON は断る', () => {
  assert.equal(parseBackup('{"name":"something"}').ok, false);
  assert.equal(parseBackup('[1,2,3]').ok, false);
  assert.equal(parseBackup('null').ok, false);
});

test('新しいバージョンの形のファイルは断る', () => {
  const backup = { ...makeBackup(sampleData, { appVersion: 'test' }), format: BACKUP_FORMAT + 1 };
  const result = parseBackup(JSON.stringify(backup));
  assert.equal(result.ok, false);
  assert.match(result.error, /新しいバージョン/);
});

test('必要な項目が欠けた記録があれば、どこが壊れているか伝えて断る', () => {
  const broken = makeBackup({ ...sampleData, cards: [sampleData.cards[0], { id: 'c3', deckId: 'd1', front: 'x' }] }, { appVersion: 'test' });
  const result = parseBackup(JSON.stringify(broken));
  assert.equal(result.ok, false);
  assert.match(result.error, /単語の2件目/);
});

test('ファイル名に日付と時刻が入る', () => {
  assert.equal(backupFileName(new Date(2026, 10, 4, 9, 5)), 'vocabulary-backup-2026-11-04-0905.json');
});

test('スタンプが入っていない古いバックアップは、学習記録からスタンプを作り直す', () => {
  const old = {
    app: 'vocabulary',
    format: 1,
    appVersion: '0.6.0（ステップ6）',
    exportedAt: '2026-11-04T12:00:00.000Z',
    data: {
      decks: [{ id: 'd1', name: '英単語', dailyGoal: 3 }],
      cards: [],
      progress: [],
      daily: [
        { id: 'd1:2026-11-03', deckId: 'd1', date: '2026-11-03', answered: 5 },
        { id: 'd1:2026-11-04', deckId: 'd1', date: '2026-11-04', answered: 1 },
      ],
      settings: [],
    },
  };
  const result = parseBackup(JSON.stringify(old));
  assert.equal(result.ok, true);
  assert.deepEqual(result.backup.data.daily.map((d) => d.achieved), [true, false]);
  assert.deepEqual(result.backup.data.stamps, [{ date: '2026-11-03', decks: ['d1'], gold: false }]);
  // 通帳もないので、スタンプの分のコインを記録する
  assert.deepEqual(result.backup.data.wallet.map((e) => [e.id, e.coins]), [['goal:d1:2026-11-03', 3]]);
});

test('通帳が入っていないステップ7のバックアップは、スタンプの分のコインを記録する（金色のボーナスも）', () => {
  const step7 = {
    app: 'vocabulary',
    format: 1,
    appVersion: '0.7.0（ステップ7）',
    exportedAt: '2026-11-04T12:00:00.000Z',
    data: {
      decks: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      cards: [],
      progress: [],
      daily: [
        { id: 'a:2026-11-04', deckId: 'a', date: '2026-11-04', answered: 5, goal: 5, achieved: true },
        { id: 'b:2026-11-04', deckId: 'b', date: '2026-11-04', answered: 5, goal: 5, achieved: true },
      ],
      stamps: [{ date: '2026-11-04', decks: ['a', 'b'], gold: true }],
      settings: [],
    },
  };
  const result = parseBackup(JSON.stringify(step7));
  assert.equal(result.ok, true);
  assert.deepEqual(result.backup.data.stamps, step7.data.stamps); // スタンプはそのまま
  assert.deepEqual(result.backup.data.wallet.map((e) => e.id), ['goal:a:2026-11-04', 'goal:b:2026-11-04', 'gold:2026-11-04']);
});
