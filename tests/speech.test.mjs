// 読み上げ（言語の決め方）のテスト
// 実行方法（vocabulary フォルダで）： node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectLang, langFor, latinLangOf, deckLang, speechTextOf, langLabel, canSpeak, speak, SPEECH_LANGS, SPEECH_RATES,
} from '../js/speech.js';
import { DECK_DEFAULTS, APP_DEFAULTS } from '../js/defaults.js';

test('文字を見て言語を決める', () => {
  assert.equal(detectLang('apple'), 'en-US');
  assert.equal(detectLang('take off'), 'en-US');
  assert.equal(detectLang('りんご'), 'ja-JP');
  assert.equal(detectLang('リンゴ'), 'ja-JP');
  assert.equal(detectLang('林檎'), 'ja-JP');          // 漢字だけは日本語
  assert.equal(detectLang('走る、走らせる'), 'ja-JP');
  assert.equal(detectLang('〜を apple する'), 'ja-JP'); // かなが入っていれば日本語
  assert.equal(detectLang('사과'), 'ko-KR');
  assert.equal(detectLang('café'), 'en-US');
  assert.equal(detectLang('café', 'fr-FR'), 'fr-FR'); // アルファベットの言語を指定
  assert.equal(detectLang('123'), 'ja-JP');
  assert.equal(detectLang(''), null);
  assert.equal(detectLang('   '), null);
  assert.equal(detectLang(undefined), null);
});

test('設定と文字から、読む言語を決める', () => {
  assert.equal(langFor('apple', 'auto'), 'en-US');
  assert.equal(langFor('apple', 'off'), null);
  assert.equal(langFor('apple', 'de-DE'), 'de-DE');
  assert.equal(langFor('りんご', 'en-US'), 'en-US'); // 選んだ言語が優先
  assert.equal(langFor('', 'en-US'), null);         // 文字がなければ読まない
  assert.equal(langFor('apple', undefined), 'en-US');
});

test('単語帳の設定で、表・裏・例文の言語を決める', () => {
  const deck = { ...DECK_DEFAULTS };
  assert.equal(deck.frontLang, 'auto');
  assert.equal(deck.backLang, 'auto');
  assert.equal(deck.autoSpeak, false);
  assert.equal(deckLang(deck, 'front', 'apple'), 'en-US');
  assert.equal(deckLang(deck, 'back', 'りんご'), 'ja-JP');
  assert.equal(deckLang(deck, 'example', 'I eat an apple.'), 'en-US');

  // 裏を「読まない」にしても、例文は読む
  const noBack = { ...deck, backLang: 'off' };
  assert.equal(deckLang(noBack, 'back', 'りんご'), null);
  assert.equal(deckLang(noBack, 'example', 'I eat an apple.'), 'en-US');

  // 表をフランス語にすると、例文や「自動」の裏のアルファベットもフランス語で読む
  const french = { ...deck, frontLang: 'fr-FR' };
  assert.equal(latinLangOf(french), 'fr-FR');
  assert.equal(deckLang(french, 'front', 'pomme'), 'fr-FR');
  assert.equal(deckLang(french, 'example', 'Je mange une pomme.'), 'fr-FR');
  assert.equal(deckLang(french, 'back', 'りんご'), 'ja-JP');
  assert.equal(latinLangOf({ frontLang: 'ja-JP', backLang: 'es-ES' }), 'es-ES');
  assert.equal(latinLangOf({ frontLang: 'ko-KR', backLang: 'auto' }), 'en-US');
});

test('読み上げる文字を整える', () => {
  assert.equal(speechTextOf('〜を走る'), 'を走る');
  assert.equal(speechTextOf('run / ran'), 'run 、 ran');
  assert.equal(speechTextOf('  a\n b  '), 'a b');
  assert.equal(speechTextOf(null), '');
});

test('言語の名前・速さの選択肢・ブラウザがないとき', () => {
  assert.equal(langLabel('en-US'), '英語');
  assert.equal(langLabel('off'), '読まない');
  assert.ok(SPEECH_LANGS.some((item) => item.id === 'auto'));
  assert.ok(SPEECH_RATES.some((rate) => rate.value === APP_DEFAULTS.speechRate));
  // Node（ブラウザなし）では読み上げはできないが、エラーにならない
  assert.equal(canSpeak(), false);
  assert.equal(speak('apple', 'en-US'), false);
});
