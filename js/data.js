// =========================================================
// アプリのデータ操作（単語帳・設定）
// 画面のプログラムからは、db.js を直接使わずにここを使う。
// =========================================================
import {
  openDB, getOne, getAll, getAllByIndex, putOne, putMany, countByIndex, requestToPromise, transactionDone,
} from './db.js';
import { STORE_NAMES } from './backup.js';
import { DECK_DEFAULTS, APP_DEFAULTS } from './defaults.js';
import { newId } from './util.js';
import { countAvailable } from './srs.js';

// ---------------- 単語帳 ----------------

// 保存されていない項目は初期設定で埋める
// （あとで設定項目を増やしても、古い単語帳がそのまま使えるように）
function withDeckDefaults(deck) {
  return deck ? { ...DECK_DEFAULTS, ...deck } : null;
}

// 単語帳を全部（作った順に）
export async function listDecks() {
  const decks = (await getAll('decks')).map(withDeckDefaults);
  decks.sort((a, b) => a.createdAt - b.createdAt);
  return decks;
}

// 単語帳を全部、単語の数つきで
export async function listDecksWithCounts() {
  const decks = await listDecks();
  for (const deck of decks) {
    deck.cardCount = await countCards(deck.id);
  }
  return decks;
}

export async function getDeck(id) {
  return withDeckDefaults(await getOne('decks', id));
}

export async function createDeck(name) {
  const deck = { id: newId(), name, createdAt: Date.now(), ...DECK_DEFAULTS };
  await putOne('decks', deck);
  return deck;
}

export async function updateDeck(id, changes) {
  const deck = await getOne('decks', id);
  if (!deck) throw new Error('単語帳が見つかりません');
  const updated = { ...deck, ...changes, id };
  await putOne('decks', updated);
  return withDeckDefaults(updated);
}

// 単語帳を消す（中の単語・覚え具合・学習記録もいっしょに消す）
export async function deleteDeck(id) {
  const db = await openDB();
  const tx = db.transaction(['decks', 'cards', 'progress', 'daily'], 'readwrite');
  tx.objectStore('decks').delete(id);
  for (const storeName of ['cards', 'progress', 'daily']) {
    const store = tx.objectStore(storeName);
    store.index('deckId').getAllKeys(id).onsuccess = (event) => {
      for (const key of event.target.result) store.delete(key);
    };
  }
  await transactionDone(tx);
}

// ---------------- 単語 ----------------
// 単語の形：{ id, deckId, front（表）, back（裏）, example（例文）, note（メモ）, createdAt, updatedAt }

export async function countCards(deckId) {
  return countByIndex('cards', 'deckId', deckId);
}

// この単語帳の単語を全部（登録した順に）
export async function listCards(deckId) {
  const cards = await getAllByIndex('cards', 'deckId', deckId);
  cards.sort((a, b) => a.createdAt - b.createdAt);
  return cards;
}

export async function getCard(id) {
  return getOne('cards', id);
}

function cleanCardFields({ front = '', back = '', example = '', note = '' }) {
  return { front: front.trim(), back: back.trim(), example: example.trim(), note: note.trim() };
}

export async function createCard(deckId, fields) {
  const now = Date.now();
  const card = { id: newId(), deckId, ...cleanCardFields(fields), createdAt: now, updatedAt: now };
  await putOne('cards', card);
  return card;
}

export async function updateCard(id, fields) {
  const card = await getOne('cards', id);
  if (!card) throw new Error('単語が見つかりません');
  const updated = { ...card, ...cleanCardFields(fields), updatedAt: Date.now() };
  await putOne('cards', updated);
  return updated;
}

// 単語を消す（覚え具合の記録もいっしょに消す）
export async function deleteCard(id) {
  const db = await openDB();
  const tx = db.transaction(['cards', 'progress'], 'readwrite');
  tx.objectStore('cards').delete(id);
  const progress = tx.objectStore('progress');
  progress.index('cardId').getAllKeys(id).onsuccess = (event) => {
    for (const key of event.target.result) progress.delete(key);
  };
  await transactionDone(tx);
}

// 一括登録の結果をまとめて保存する（importer.js の planImport の結果を渡す）
export async function applyImport(deckId, plan) {
  const now = Date.now();
  const newCards = plan.toAdd.map((fields, i) => ({
    id: newId(),
    deckId,
    ...cleanCardFields(fields),
    createdAt: now + i, // 貼り付けた順番どおりに並ぶよう、少しずつずらす
    updatedAt: now + i,
  }));
  const updatedCards = plan.toUpdate.map((card) => ({ ...card, ...cleanCardFields(card), updatedAt: now }));
  await putMany('cards', [...newCards, ...updatedCards]);
  return { added: newCards.length, updated: updatedCards.length };
}

// ---------------- 覚え具合・日ごとの学習記録 ----------------

// この単語帳の覚え具合の記録を全部
export async function listProgress(deckId) {
  return getAllByIndex('progress', 'deckId', deckId);
}

// 1つの単語の覚え具合（表→裏・裏→表）
export async function listProgressForCard(cardId) {
  return getAllByIndex('progress', 'cardId', cardId);
}

// 日ごとの学習記録の形：
//   { id, deckId, date, answered（解いた数）, newCount（新しく出した単語の数）,
//     good, hard, again（それぞれの答えの数） }
// ※ いまは「今日の日付」で数えている。ステップ7で、猶予時間中は前日に数えるしくみを入れる。
function emptyDaily(deckId, date) {
  return { id: `${deckId}:${date}`, deckId, date, answered: 0, newCount: 0, good: 0, hard: 0, again: 0, choice: 0 };
}

export async function getDaily(deckId, date) {
  return (await getOne('daily', `${deckId}:${date}`)) ?? emptyDaily(deckId, date);
}

// 1問答えたときの記録（覚え具合と、日ごとの記録を同時に保存する）
//   progress    : srs.js の schedule() で計算した新しい覚え具合
//   grade       : good / hard / again / choice（4択の正解）
//   day         : 数える日（'2026-11-04' の形）
//   countsAsNew : 「新しい単語」として数えるか
export async function recordAnswer({ progress, grade, day, countsAsNew }) {
  const db = await openDB();
  const tx = db.transaction(['progress', 'daily'], 'readwrite');
  tx.objectStore('progress').put(progress);
  const dailyStore = tx.objectStore('daily');
  dailyStore.get(`${progress.deckId}:${day}`).onsuccess = (event) => {
    const daily = event.target.result ?? emptyDaily(progress.deckId, day);
    daily.answered += 1;
    daily[grade] = (daily[grade] ?? 0) + 1;
    if (countsAsNew) daily.newCount += 1;
    dailyStore.put(daily);
  };
  await transactionDone(tx);
}

// ホーム画面用：単語帳ごとの「今日」のようす
export async function getDeckToday(deck, today) {
  const [cards, progressList, daily] = await Promise.all([
    listCards(deck.id),
    listProgress(deck.id),
    getDaily(deck.id, today),
  ]);
  const available = countAvailable({
    cards,
    progressList,
    directions: deck.directions,
    today,
    newLimit: deck.newPerDay - daily.newCount,
  });
  return { cardCount: cards.length, daily, ...available };
}

// ---------------- バックアップ用：全データの読み出し・置き換え ----------------

// 全部の棚の中身を読み出す
export async function exportAllData() {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES);
  const entries = await Promise.all(
    STORE_NAMES.map(async (name) => [name, await requestToPromise(tx.objectStore(name).getAll())]),
  );
  return Object.fromEntries(entries);
}

// 全部の棚の中身を、渡されたデータで置き換える
// （1つのまとまった書き込みなので、途中で失敗したら何も変わらない）
export async function replaceAllData(data) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES, 'readwrite');
  for (const name of STORE_NAMES) {
    const store = tx.objectStore(name);
    store.clear();
    for (const record of data[name] ?? []) store.put(record);
  }
  await transactionDone(tx);
}

// ---------------- 設定 ----------------

export async function getSettings() {
  const saved = await getOne('settings', 'app');
  return { ...APP_DEFAULTS, ...(saved?.value ?? {}) };
}

export async function saveSettings(changes) {
  const current = await getSettings();
  const value = { ...current, ...changes };
  await putOne('settings', { key: 'app', value });
  return value;
}
