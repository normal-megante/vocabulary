// ホーム画面に追加（PWA）まわりのテスト
// 実行方法（vocabulary フォルダで）： node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// フォルダの中のファイルを全部（サブフォルダも）並べる
function listFiles(dir) {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(root, path)).isDirectory() ? listFiles(path) : [path.split(sep).join('/')];
  });
}

// sw.js の PRECACHE に書いてあるファイル名を取り出す
function precacheList() {
  const source = readFileSync(join(root, 'sw.js'), 'utf8');
  const block = source.match(/const PRECACHE = \[([\s\S]*?)\];/);
  assert.ok(block, 'sw.js に PRECACHE が見つかりません');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('アプリのファイルは全部 sw.js の PRECACHE に書いてある', () => {
  const list = precacheList();
  const needed = [
    'index.html',
    'manifest.webmanifest',
    ...listFiles('css'),
    ...listFiles('js'),
    ...listFiles('icons'),
  ];
  const missing = needed.filter((file) => !list.includes(file));
  assert.deepEqual(missing, [], `sw.js の PRECACHE に書き足してください: ${missing.join(', ')}`);
});

test('PRECACHE に書いてあるファイルは、ちゃんと存在する', () => {
  const notFound = precacheList().filter((file) => file !== './' && !existsSync(join(root, file)));
  assert.deepEqual(notFound, [], `存在しないファイルがあります: ${notFound.join(', ')}`);
});

test('manifest の内容とアイコン', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  for (const icon of manifest.icons) {
    assert.ok(existsSync(join(root, icon.src)), `アイコンがありません: ${icon.src}`);
  }
  // Android で必要な大きさ（192 と 512）と、丸く切り抜く用（maskable）がそろっている
  const sizes = manifest.icons.map((icon) => icon.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
});

test('index.html から manifest を読み込んでいる', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  // 公開先（/vocabulary/）でも動くように、絶対パス（/ で始まる）を使っていない
  assert.doesNotMatch(html, /(href|src)="\//);
});
