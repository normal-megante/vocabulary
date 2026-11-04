// =========================================================
// アプリのデータ操作（単語帳・設定）
// 画面のプログラムからは、db.js を直接使わずにここを使う。
// =========================================================
import {
  openDB, getOne, getAll, getAllByIndex, putOne, putMany, countByIndex, requestToPromise, transactionDone,
} from './db.js';
import { STORE_NAMES } from './backup.js';
import { DECK_DEFAULTS, APP_DEFAULTS, COIN_REWARDS } from './defaults.js';
import { newId, toDateKey } from './util.js';
import { countAvailable, addDays } from './srs.js';
import { studyDay, inGrace, isAchieved, addAnswer, recheckGoal, makeOverallStamp } from './stamps.js';
import {
  goalEntry, goldEntry, buyEntry, restEntry, walletOf, canBuy, planRestDays,
} from './wallet.js';
import { findBingos, bingoEntry, filledDates } from './bingo.js';
import { trophyStats, ownedTrophies, newTrophies, trophyEntry } from './trophies.js';

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
//     good, hard, again, choice（それぞれの答えの数）,
//     goal（その日のきょうのぶんの問題数）, achieved（達成した ＝ 単語帳のスタンプ） }
// date は「数える日」。猶予の時間（夜中）に前の日の分として数えたときは、前の日の日付になる。
function emptyDaily(deckId, date) {
  return { id: `${deckId}:${date}`, deckId, date, answered: 0, newCount: 0, good: 0, hard: 0, again: 0, choice: 0 };
}

export async function getDaily(deckId, date) {
  return (await getOne('daily', `${deckId}:${date}`)) ?? emptyDaily(deckId, date);
}

// この単語帳の「数える日」（夜中に前の日の分として数えるかどうかも、ここで決まる：stamps.js）
//   → { day: '2026-11-04', late: 前の日の分として数えているか }
export async function getStudyDay(deck, graceHour, now = new Date()) {
  let yesterdayAchieved = true;
  if (now.getHours() < graceHour && deck.dailyGoal > 0) {
    yesterdayAchieved = isAchieved(await getDaily(deck.id, addDays(toDateKey(now), -1)));
  }
  return studyDay({ now, graceHour, goal: deck.dailyGoal, yesterdayAchieved });
}

// 1問答えたときの記録（覚え具合と、日ごとの記録を同時に保存する）
//   progress    : srs.js の schedule() で計算した新しい覚え具合
//   grade       : good / hard / again / choice（4択の正解）
//   day         : 数える日（'2026-11-04' の形）
//   countsAsNew : 「新しい単語」として数えるか
//   goal        : この単語帳のきょうのぶんの問題数
//   → { daily, achievedNow（この1問できょうのぶん達成）, goldNow（全体のスタンプが金色になった）,
//       coins（達成・金色でもらったコイン）, bingos（この達成でそろったビンゴ） }
export async function recordAnswer({ progress, grade, day, countsAsNew, goal }) {
  const db = await openDB();
  const tx = db.transaction(['progress', 'daily', 'wallet'], 'readwrite');
  tx.objectStore('progress').put(progress);
  const dailyStore = tx.objectStore('daily');
  let result;
  dailyStore.get(`${progress.deckId}:${day}`).onsuccess = (event) => {
    const current = event.target.result ?? emptyDaily(progress.deckId, day);
    result = addAnswer(current, { grade, countsAsNew, goal });
    dailyStore.put(result.daily);
    // 達成したらコイン（記録といっしょに保存する）
    if (result.achievedNow) tx.objectStore('wallet').put(goalEntry(progress.deckId, day));
  };
  await transactionDone(tx);

  let goldNow = false;
  let bingos = [];
  if (result.achievedNow) {
    ({ goldNow } = await refreshOverallStamp(day));
    bingos = await claimBingos();
  }
  return {
    daily: result.daily,
    achievedNow: result.achievedNow,
    goldNow,
    coins: coinsFor(result.achievedNow, goldNow),
    bingos,
  };
}

// 達成したとき・金色になったときに、もらえるコインの数
function coinsFor(achievedNow, goldNow) {
  return (achievedNow ? COIN_REWARDS.goal : 0) + (goldNow ? COIN_REWARDS.goldBonus : 0);
}

// ホーム画面用：単語帳ごとの「今日」のようす（day は数える日）
export async function getDeckToday(deck, graceHour) {
  const { day, late } = await getStudyDay(deck, graceHour);
  const [cards, progressList, daily] = await Promise.all([
    listCards(deck.id),
    listProgress(deck.id),
    getDaily(deck.id, day),
  ]);
  const available = countAvailable({
    cards,
    progressList,
    directions: deck.directions,
    today: day,
    newLimit: deck.newPerDay - daily.newCount,
  });
  return { day, late, cardCount: cards.length, daily, ...available };
}

// ---------------- スタンプ ----------------

// その日の全体のスタンプを作り直す（単語帳が達成したとき・設定を変えたときに呼ぶ）
// 金色になったら、ボーナスのコインもいっしょに記録する。
//   → { stamp, goldNow（いま金色になった） }
export async function refreshOverallStamp(date) {
  const [decks, dailies, previous] = await Promise.all([
    listDecksWithCounts(),
    getAllByIndex('daily', 'date', date),
    getOne('stamps', date),
  ]);
  const stamp = makeOverallStamp(date, {
    previous: previous ?? null,
    achievedDeckIds: dailies.filter(isAchieved).map((daily) => daily.deckId),
    activeDeckIds: decks.filter((deck) => deck.dailyGoal > 0 && deck.cardCount > 0).map((deck) => deck.id),
  });
  const goldNow = Boolean(stamp?.gold && !previous?.gold);
  if (stamp && JSON.stringify(stamp) !== JSON.stringify(previous)) {
    const db = await openDB();
    const tx = db.transaction(['stamps', 'wallet'], 'readwrite');
    tx.objectStore('stamps').put(stamp);
    if (goldNow) tx.objectStore('wallet').put(goldEntry(date));
    await transactionDone(tx);
  }
  return { stamp, goldNow };
}

// 単語帳の問題数を変えたとき：その単語帳の「数える日」の記録を見直す
// （下げてもう届いていれば達成にする＝コインも。全体のスタンプも見直す）
//   → { achievedNow, goldNow, coins, bingos }
export async function recheckDeckToday(deck, graceHour) {
  const { day } = await getStudyDay(deck, graceHour);
  const saved = await getOne('daily', `${deck.id}:${day}`);
  let achievedNow = false;
  if (saved) {
    const result = recheckGoal(saved, deck.dailyGoal);
    achievedNow = result.achievedNow;
    if (result.daily !== saved) {
      const db = await openDB();
      const tx = db.transaction(['daily', 'wallet'], 'readwrite');
      tx.objectStore('daily').put(result.daily);
      if (achievedNow) tx.objectStore('wallet').put(goalEntry(deck.id, day));
      await transactionDone(tx);
    }
  }
  const { goldNow } = await refreshOverallStamp(day);
  const bingos = achievedNow ? await claimBingos() : [];
  return { achievedNow, goldNow, coins: coinsFor(achievedNow, goldNow), bingos };
}

// 全体のスタンプを全部
export async function listOverallStamps() {
  return getAll('stamps');
}

// この単語帳の、達成した日の記録を全部
export async function listAchievedDays(deckId) {
  return (await getAllByIndex('daily', 'deckId', deckId)).filter(isAchieved);
}

// ---------------- コインとアイテム（wallet.js） ----------------

// いまのコイン・持っているアイテム・お休みにした日
//   → { coins, items: { rest }, restDates }
export async function getWallet() {
  return walletOf(await getAll('wallet'));
}

// コインでアイテムと交換する
//   → { ok, reason }（できなかったときは reason に理由）
// 通帳を読む → 交換できるか確かめる → 記録する、を1つのまとまった処理で行う（2回押しても2回買わない）
export async function buyItem(itemKey) {
  const db = await openDB();
  const tx = db.transaction('wallet', 'readwrite');
  const store = tx.objectStore('wallet');
  let result;
  store.getAll().onsuccess = (event) => {
    result = canBuy(walletOf(event.target.result), itemKey);
    if (result.ok) store.put(buyEntry(itemKey, newId()));
  };
  await transactionDone(tx);
  return result;
}

// 連続が切れそうなら、お休みチケットを自動で使う（ホームやスタンプ画面を開いたときに呼ぶ）
//   → お休みにした日の一覧（使わなかったら []）
export async function useRestTickets(graceHour, now = new Date()) {
  const db = await openDB();
  const tx = db.transaction(['stamps', 'wallet'], 'readwrite');
  const walletStore = tx.objectStore('wallet');
  const stampKeys = tx.objectStore('stamps').getAllKeys();
  let used = [];
  walletStore.getAll().onsuccess = (event) => {
    const wallet = walletOf(event.target.result);
    used = planRestDays({
      streakDates: new Set([...stampKeys.result, ...wallet.restDates]),
      tickets: wallet.items.rest,
      today: toDateKey(now),
      graceActive: inGrace(now, graceHour),
    });
    for (const date of used) walletStore.put(restEntry(date));
  };
  await transactionDone(tx);
  return used;
}

// スタンプカードでそろったビンゴのコインを受け取る（まだもらっていないものだけ）
// （達成したとき・ホームやスタンプ画面を開いたときに呼ぶ。お休みの日でそろったものもここで）
//   → 新しくもらったビンゴの一覧（bingo.js の findBingos の形）
export async function claimBingos() {
  const db = await openDB();
  const tx = db.transaction(['stamps', 'wallet'], 'readwrite');
  const walletStore = tx.objectStore('wallet');
  const stampKeys = tx.objectStore('stamps').getAllKeys();
  let found = [];
  walletStore.getAll().onsuccess = (event) => {
    const entries = event.target.result;
    const already = new Set(entries.map((entry) => entry.id));
    const filled = filledDates(stampKeys.result, walletOf(entries).restDates);
    found = findBingos(filled).filter((bingo) => !already.has(bingo.id));
    for (const bingo of found) walletStore.put(bingoEntry(bingo));
  };
  await transactionDone(tx);
  return found;
}

// ---------------- トロフィー（trophies.js） ----------------

// 条件を満たしたトロフィーを受け取る（まだもらっていないものだけ。コインも通帳に入る）
// （ホーム・スタンプ・トロフィーの画面を開いたとき、学習で達成したとき・終わったときに呼ぶ）
//   events : いま起きたこと（'nightOwl' 夜ふかし・'earlyBird' 早起き）
//   → { found: 新しく取ったトロフィー, ownedBefore: その前に持っていた数 }
export async function claimTrophies(events = []) {
  const db = await openDB();
  const tx = db.transaction(['stamps', 'daily', 'progress', 'wallet'], 'readwrite');
  const stampsRequest = tx.objectStore('stamps').getAll();
  const dailyRequest = tx.objectStore('daily').getAll();
  const progressRequest = tx.objectStore('progress').getAll();
  const walletStore = tx.objectStore('wallet');
  let result = { found: [], ownedBefore: 0 };
  walletStore.getAll().onsuccess = (event) => {
    const entries = event.target.result;
    const owned = ownedTrophies(entries);
    const stats = trophyStats({
      stampList: stampsRequest.result,
      walletEntries: entries,
      dailyList: dailyRequest.result,
      progressList: progressRequest.result,
      events,
    });
    const found = newTrophies(stats, owned);
    for (const trophy of found) walletStore.put(trophyEntry(trophy));
    result = { found, ownedBefore: owned.size };
  };
  await transactionDone(tx);
  return result;
}

// トロフィー画面用：判定に使う数と、取ったトロフィー（key → 取った時刻）
export async function getTrophyState() {
  const [stampList, walletEntries, dailyList, progressList] = await Promise.all([
    getAll('stamps'), getAll('wallet'), getAll('daily'), getAll('progress'),
  ]);
  return {
    stats: trophyStats({ stampList, walletEntries, dailyList, progressList }),
    owned: ownedTrophies(walletEntries),
  };
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
