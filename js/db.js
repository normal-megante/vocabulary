// =========================================================
// データ保存のしくみ（IndexedDB）
//
// IndexedDB は、ブラウザの中にある「データの保管庫」です。
// アプリのデータはすべてここに保存され、スマホの外には送られません。
//
// 保管庫の中には、種類ごとに「棚」（ストア）があります。
//   decks    : 単語帳
//   cards    : 単語（表・裏・例文・メモ）
//   progress : 覚え具合の記録（単語 × 出題の向き ごと）
//   daily    : 日ごとの学習記録（単語帳 × 日付 ごと。ノルマ・スタンプ用）
//   settings : アプリ全体の設定
// =========================================================

const DB_NAME = 'vocabulary';

// データの形を変えるときは、この数字を1つ上げて、
// 下の upgrade() に「前の形から新しい形への直し方」を書き足す。
// （こうすると、すでに入っているデータを消さずに形を変えられる）
const DB_VERSION = 1;

function upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    db.createObjectStore('decks', { keyPath: 'id' });

    const cards = db.createObjectStore('cards', { keyPath: 'id' });
    cards.createIndex('deckId', 'deckId');

    const progress = db.createObjectStore('progress', { keyPath: 'id' });
    progress.createIndex('deckId', 'deckId');
    progress.createIndex('cardId', 'cardId');

    const daily = db.createObjectStore('daily', { keyPath: 'id' });
    daily.createIndex('deckId', 'deckId');
    daily.createIndex('date', 'date');

    db.createObjectStore('settings', { keyPath: 'key' });
  }
  // 例：将来 DB_VERSION を 2 にしたら、ここに
  // if (oldVersion < 2) { ... } を書き足す
}

// ---- 保管庫を開く（最初の1回だけ実際に開き、あとは使い回す） ----
let dbPromise = null;

export function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => upgrade(request.result, event.oldVersion);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('アプリが別のタブでも開いています。ほかのタブを閉じてください。'));
    });
  }
  return dbPromise;
}

// IndexedDB の「お願い」が終わるのを待てる形にする
export function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// まとめて行う書き込み（トランザクション）が、全部終わるのを待てる形にする
export function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('保存が中断されました'));
  });
}

// ---- よく使う読み書き ----

// 1件読む
export async function getOne(storeName, key) {
  const db = await openDB();
  return requestToPromise(db.transaction(storeName).objectStore(storeName).get(key));
}

// 全部読む
export async function getAll(storeName) {
  const db = await openDB();
  return requestToPromise(db.transaction(storeName).objectStore(storeName).getAll());
}

// 条件に合うものを全部読む（例：この単語帳の単語を全部）
export async function getAllByIndex(storeName, indexName, value) {
  const db = await openDB();
  const store = db.transaction(storeName).objectStore(storeName);
  return requestToPromise(store.index(indexName).getAll(value));
}

// 条件に合うものの数を数える
export async function countByIndex(storeName, indexName, value) {
  const db = await openDB();
  const store = db.transaction(storeName).objectStore(storeName);
  return requestToPromise(store.index(indexName).count(value));
}

// 1件保存する（同じ ID があれば上書き）
export async function putOne(storeName, value) {
  return putMany(storeName, [value]);
}

// まとめて保存する（途中で失敗したら、全部なかったことになる）
export async function putMany(storeName, values) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  for (const value of values) store.put(value);
  await transactionDone(tx);
  return values;
}

// 1件消す
export async function deleteOne(storeName, key) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(key);
  await transactionDone(tx);
}
