// 一括登録の読み取りのテスト
// 実行方法（vocabulary フォルダで）： node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImportText, planImport } from '../js/importer.js';

test('タブ区切りの4列を読み取れる', () => {
  const { rows, errors } = parseImportText('apple\tりんご\tI ate an apple.\t果物\nbook\t本');
  assert.equal(errors.length, 0);
  assert.deepEqual(rows, [
    { line: 1, front: 'apple', back: 'りんご', example: 'I ate an apple.', note: '果物' },
    { line: 2, front: 'book', back: '本', example: '', note: '' },
  ]);
});

test('Windows の改行（\\r\\n）と、最後の改行・空行を正しく扱う', () => {
  const { rows } = parseImportText('a\tあ\r\n\r\nb\tい\r\n');
  assert.deepEqual(rows.map((r) => [r.line, r.front]), [[1, 'a'], [3, 'b']]);
});

test('前後の空白は取り除く', () => {
  const { rows } = parseImportText('  cat \t ねこ \t\t');
  assert.equal(rows[0].front, 'cat');
  assert.equal(rows[0].back, 'ねこ');
});

test('1行目が「表・裏」の見出しなら飛ばす', () => {
  const result = parseImportText('表\t裏\t例文\tメモ\ndog\t犬');
  assert.equal(result.headerSkipped, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].front, 'dog');
});

test('タブがない行・表や裏が空の行はエラーにする', () => {
  const { rows, errors } = parseImportText('タブなし\n\t裏だけ\n表だけ\t\nok\tOK');
  assert.equal(rows.length, 1);
  assert.deepEqual(errors.map((e) => [e.line, e.reason]), [
    [1, 'タブで区切られていません'],
    [2, '「表」が空です'],
    [3, '「裏」が空です'],
  ]);
});

test('セルの中の改行（"..." で囲まれたもの）を1つのセルとして読む', () => {
  const text = 'run\t"走る\n経営する"\t"He said ""hi""."\nwalk\t歩く';
  const { rows, errors } = parseImportText(text);
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].back, '走る\n経営する');
  assert.equal(rows[0].example, 'He said "hi".');
  assert.equal(rows[1].front, 'walk');
  assert.equal(rows[1].line, 3); // セルの中の改行のぶん、行番号が進む
});

test('囲みではない " はそのまま文字として残す', () => {
  const { rows } = parseImportText('"Hi," she said.\tこんにちは');
  assert.equal(rows[0].front, '"Hi," she said.');
});

test('planImport：同じ表は「登録しない」', () => {
  const existing = [{ id: 'c1', front: 'Apple', back: 'りんご', example: '', note: '' }];
  const rows = parseImportText('apple\t林檎\nbanana\tバナナ\nbanana\tばなな').rows;
  const plan = planImport(rows, existing, 'skip');
  assert.deepEqual(plan.toAdd.map((c) => c.back), ['バナナ']);
  assert.equal(plan.toUpdate.length, 0);
  assert.equal(plan.skipped, 2); // 今ある apple と、2回目の banana
});

test('planImport：同じ表は「上書き」', () => {
  const existing = [{ id: 'c1', deckId: 'd1', front: 'apple', back: 'りんご', example: '', note: '', createdAt: 1 }];
  const rows = parseImportText('ａｐｐｌｅ\t林檎\tex\nbanana\tバナナ\nbanana\tばなな').rows;
  const plan = planImport(rows, existing, 'overwrite');
  assert.deepEqual(plan.toUpdate, [
    { id: 'c1', deckId: 'd1', front: 'ａｐｐｌｅ', back: '林檎', example: 'ex', note: '', createdAt: 1 },
  ]);
  assert.deepEqual(plan.toAdd.map((c) => c.back), ['ばなな']); // あとの行が勝つ
  assert.equal(plan.skipped, 0);
});

test('planImport：「全部追加」なら重なっても追加する', () => {
  const existing = [{ id: 'c1', front: 'light', back: '光' }];
  const rows = parseImportText('light\t軽い\nlight\t明るい').rows;
  const plan = planImport(rows, existing, 'add');
  assert.equal(plan.toAdd.length, 2);
  assert.equal(plan.skipped, 0);
});
