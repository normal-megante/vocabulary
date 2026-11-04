// =========================================================
// ホーム画面への追加（インストール）
//
// Chrome は「このアプリはホーム画面に追加できますよ」という合図を出します。
// その合図を取っておいて、設定画面の「ホーム画面に追加する」ボタンで使います。
// =========================================================

let installEvent = null;    // Chrome の「追加しますか？」画面を出すための合図
let justInstalled = false;  // このページを開いている間に追加された
const listeners = new Set();

// アプリの起動時に1回だけ呼ぶ（合図を聞き逃さないように）
export function setupInstall() {
  window.addEventListener('beforeinstallprompt', (event) => {
    installEvent = event;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    justInstalled = true;
    notify();
  });
}

// ホーム画面のアイコンから（アプリとして）開いているか
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches;
}

// 今の状態
//   'app'       … アプリとして開いている
//   'installed' … たった今、ホーム画面に追加された
//   'ready'     … ボタンで追加できる
//   'manual'    … ボタンは使えない（Chrome のメニューから追加してもらう）
export function installState() {
  if (isStandalone()) return 'app';
  if (justInstalled) return 'installed';
  if (installEvent) return 'ready';
  return 'manual';
}

// Chrome の「ホーム画面に追加しますか？」を出す。追加を選んだら true。
export async function promptInstall() {
  const event = installEvent;
  if (!event) return false;
  installEvent = null; // 合図は1回しか使えない
  await event.prompt();
  const { outcome } = await event.userChoice;
  notify();
  return outcome === 'accepted';
}

// 状態が変わったら知らせてもらう（画面を離れたら signal で止まる）
export function onInstallChange(callback, signal) {
  listeners.add(callback);
  signal?.addEventListener('abort', () => listeners.delete(callback));
}

function notify() {
  listeners.forEach((callback) => callback());
}
