// =========================================================
// アプリのスタート地点と、画面の切り替え
//
// アドレスの最後の「#/home」「#/decks」などの部分を見て、
// どの画面を表示するかを決めています。
// （この方式だと、スマホの「戻る」ボタンもそのまま使えます）
// =========================================================
import * as home from './screens/home.js';
import * as decks from './screens/decks.js';
import * as deck from './screens/deck.js';
import * as importScreen from './screens/import.js';
import * as card from './screens/card.js';
import * as study from './screens/study.js';
import * as stamps from './screens/stamps.js';
import * as trophies from './screens/trophies.js';
import * as settings from './screens/settings.js';
import { escapeHtml } from './util.js';
import { enterEntry, saveScroll, savedScroll, goBack, replaceLocation } from './nav.js';
import { setupInstall } from './install.js';

// 画面の一覧
//   path : アドレスの形（( ) の部分には単語帳の ID などが入る）
//   tab  : 下のタブのどれを光らせるか（null ならタブを隠す）
//   back : 左上の「‹」で戻る先（なければ「‹」を出さない）
const routes = [
  { path: /^\/home$/, screen: home, tab: 'home' },
  { path: /^\/decks$/, screen: decks, tab: 'decks' },
  { path: /^\/decks\/([^/]+)$/, screen: deck, tab: 'decks', back: () => '#/decks' },
  { path: /^\/decks\/([^/]+)\/import$/, screen: importScreen, tab: 'decks', back: (deckId) => `#/decks/${deckId}` },
  { path: /^\/decks\/([^/]+)\/cards\/([^/]+)$/, screen: card, tab: 'decks', back: (deckId) => `#/decks/${deckId}` },
  { path: /^\/study\/([^/]+)$/, screen: study, tab: null, back: () => '#/home' },
  { path: /^\/stamps$/, screen: stamps, tab: 'stamps' },
  { path: /^\/trophies$/, screen: trophies, tab: 'stamps', back: () => '#/stamps' },
  { path: /^\/settings$/, screen: settings, tab: 'settings' },
];

const view = document.getElementById('view');
const titleEl = document.getElementById('page-title');
const backBtn = document.getElementById('back-btn');

let backTarget = '#/home';
let renderId = 0;
// 画面を離れるときに、その画面が付けたキー操作などを止めるための合図
let screenController = null;

backBtn.addEventListener('click', () => goBack(backTarget));

function setTitle(text) {
  titleEl.textContent = text ?? '';
}

// ---- 画面を表示する ----
async function showScreen({ keepScroll = false } = {}) {
  if (!keepScroll) saveScroll();
  const { cameBack } = enterEntry();

  const path = location.hash.replace(/^#/, '') || '/home';
  const route = routes.find((r) => r.path.test(path));
  if (!route) {
    replaceLocation('#/home'); // 知らないアドレスならホームへ
    return;
  }
  const rawParams = path.match(route.path).slice(1);
  const params = rawParams.map(decodeURIComponent);
  const myId = ++renderId;

  // 下のタブ・左上の「‹」・タイトルを、画面に合わせて切り替える
  document.querySelectorAll('.tabbar a').forEach((a) => {
    a.classList.toggle('active', a.dataset.tab === route.tab);
  });
  document.body.classList.toggle('no-tabbar', !route.tab);
  backBtn.hidden = !route.back;
  backTarget = route.back ? route.back(...rawParams) : '#/home';
  setTitle(route.screen.title);

  // 前の画面の後片付け
  screenController?.abort();
  screenController = new AbortController();

  // 新しい画面の中身を作る
  const container = document.createElement('div');
  container.className = 'screen';
  const context = {
    params,
    signal: screenController.signal, // addEventListener(..., { signal }) で使う
    setTitle: (text) => { if (myId === renderId) setTitle(text); },
    refresh: () => showScreen({ keepScroll: true }),
    goBack: () => goBack(backTarget),
  };
  try {
    await route.screen.render(container, context);
  } catch (error) {
    console.error(error);
    container.innerHTML = `
      <div class="card error">
        <p>エラーが起きました。</p>
        <p class="muted">${escapeHtml(error.message)}</p>
      </div>`;
  }

  // 作っている間に別の画面へ移動していたら、この結果は使わない
  if (myId !== renderId) return;
  view.replaceChildren(container);
  if (!keepScroll) window.scrollTo(0, cameBack ? savedScroll() : 0);
}

// ---- スタート ----
// ホーム画面に追加できるようになった合図を、聞き逃さないように先に準備
setupInstall();
// ネットにつながっていなくても開けるようにする（くわしくは sw.js）
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((error) => {
    console.warn('サービスワーカーを登録できませんでした', error);
  });
}

if (!('indexedDB' in window)) {
  view.innerHTML = '<div class="card error">このブラウザではデータを保存できないため、アプリを使えません。</div>';
} else {
  // ブラウザに「このアプリのデータを勝手に消さないで」とお願いする
  navigator.storage?.persist?.().catch(() => {});

  window.addEventListener('hashchange', () => showScreen());
  showScreen();
}
