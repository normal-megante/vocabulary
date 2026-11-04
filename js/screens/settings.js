// =========================================================
// 設定画面：バックアップ・学習の設定・読み上げの速さ・データについて
// =========================================================
import { getSettings, saveSettings, listDecksWithCounts, exportAllData, replaceAllData } from '../data.js';
import { makeBackup, parseBackup, backupFileName } from '../backup.js';
import { APP_VERSION, GOAL_LABEL } from '../defaults.js';
import { formatDateTimeJa } from '../util.js';
import { confirmDialog, alertDialog, showToast, downloadFile } from '../ui.js';
import { replaceLocation } from '../nav.js';
import { installState, promptInstall, onInstallChange } from '../install.js';
import { SPEECH_RATES, canSpeak, speak } from '../speech.js';

export const title = '設定';

// 猶予時刻の選択肢（0 は「使わない」）
const GRACE_CHOICES = [0, 1, 2, 3, 4, 5, 6];

// 「ホーム画面に追加」の欄（アプリとして開いているときは出さない）
function installSection(state) {
  if (state === 'app') return '';
  let body;
  if (state === 'installed') {
    body = '<p>追加しました！ これからは、ホーム画面の「単語帳」アイコンから開いてください。</p>';
  } else if (state === 'ready') {
    body = `
      <p class="muted">ホーム画面に追加すると、ふつうのアプリのように開けます。一度開いたあとは、ネットにつながっていなくても使えます。</p>
      <button class="btn primary block" type="button" id="install-btn" style="margin-top:12px">ホーム画面に追加する</button>`;
  } else {
    body = `
      <p class="muted">ホーム画面に追加すると、ふつうのアプリのように開けます。一度開いたあとは、ネットにつながっていなくても使えます。</p>
      <p style="margin-top:8px">Chrome の右上の「︙」メニューから「ホーム画面に追加」（または「アプリをインストール」）を選んでください。</p>`;
  }
  return `<section class="card"><h3>📱 ホーム画面に追加</h3>${body}</section>`;
}

export async function render(el, { refresh, signal }) {
  const install = installState();
  const settings = await getSettings();
  const decks = await listDecksWithCounts();
  const totalCards = decks.reduce((sum, deck) => sum + deck.cardCount, 0);

  // 「データを勝手に消さないで」のお願いが通っているか
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  // 使っている容量
  const estimate = await navigator.storage?.estimate?.().catch(() => null);
  const usedKB = estimate ? Math.ceil(estimate.usage / 1024) : null;

  el.innerHTML = `
    ${installSection(install)}

    <section class="card">
      <h3>💾 バックアップ</h3>
      <p class="muted">データはこのスマホの中だけに保存されています。故障・機種変更・アプリの削除に備えて、ときどきファイルに保存しておきましょう。</p>
      <dl class="info-list" style="margin:12px 0">
        <dt>最後のバックアップ</dt>
        <dd>${settings.lastBackupAt ? formatDateTimeJa(new Date(settings.lastBackupAt)) : 'まだありません'}</dd>
      </dl>
      <div class="stack" style="margin-top:0">
        <button class="btn primary block" type="button" id="export-btn">バックアップを保存</button>
        <button class="btn block" type="button" id="import-btn">バックアップから戻す</button>
        <input type="file" id="import-file" hidden>
      </div>
      <p class="muted" style="margin-top:12px">保存したファイルは、スマホの「ダウンロード」フォルダに入ります。Google ドライブなどにも入れておくと、さらに安心です。</p>
    </section>

    <section class="card">
      <h3>🌙 夜中の猶予時刻</h3>
      <p class="muted">夜中の0時を過ぎても、この時刻までは、前の日の「${GOAL_LABEL}」がまだ達成されていなければ、前の日の分として数えます（前の日のスタンプにできます）。</p>
      <select id="grace-select" aria-label="猶予時刻" style="margin-top:10px">
        ${GRACE_CHOICES.map((hour) => `
          <option value="${hour}" ${hour === settings.graceHour ? 'selected' : ''}>
            ${hour === 0 ? '使わない（0時で次の日）' : `午前${hour}時まで`}
          </option>`).join('')}
      </select>
      <p class="muted" style="margin-top:10px">「${GOAL_LABEL}」の問題数・新しい単語の数・出題の向きは、単語帳ごとの画面で設定します。</p>
    </section>

    <section class="card">
      <h3>🔊 読み上げの速さ</h3>
      ${canSpeak() ? `
        <select id="rate-select" aria-label="読み上げの速さ" style="margin-top:10px">
          ${SPEECH_RATES.map(({ value, label }) => `
            <option value="${value}" ${value === settings.speechRate ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
        <p class="muted" style="margin-top:10px">選ぶと、ためしに読み上げます。読み上げる言語と「自動で読む」は、単語帳ごとの画面で設定します。</p>`
        : '<p class="muted">このブラウザでは読み上げを使えません。</p>'}
    </section>

    <section class="card">
      <h3>データについて</h3>
      <dl class="info-list">
        <dt>入っているもの</dt><dd>単語帳 ${decks.length}冊・単語 ${totalCards}語</dd>
        <dt>保存場所</dt><dd>この端末のブラウザの中</dd>
        <dt>開き方</dt><dd>${install === 'app' ? 'アプリ（ホーム画面から）' : 'ブラウザ'}</dd>
        <dt>消えにくい設定</dt><dd>${persisted ? '有効' : '未設定'}</dd>
        <dt>使用量</dt><dd>${usedKB === null ? '不明' : `約 ${usedKB.toLocaleString()} KB`}</dd>
        <dt>バージョン</dt><dd>${APP_VERSION}</dd>
      </dl>
    </section>`;

  // ---- ホーム画面に追加 ----
  el.querySelector('#install-btn')?.addEventListener('click', async () => {
    const accepted = await promptInstall();
    if (accepted) showToast('ホーム画面に追加しています…');
  });
  // 追加できるようになった・追加された、などのときは表示を更新
  onInstallChange(() => refresh(), signal);

  // ---- 猶予時刻（選んだらすぐ保存） ----
  el.querySelector('#grace-select').addEventListener('change', async (event) => {
    const graceHour = Number(event.target.value);
    await saveSettings({ graceHour });
    showToast(graceHour === 0 ? '猶予時刻を使わないようにしました' : `猶予時刻を午前${graceHour}時にしました`);
  });

  // ---- 読み上げの速さ（選んだらすぐ保存して、ためしに読む） ----
  el.querySelector('#rate-select')?.addEventListener('change', async (event) => {
    const speechRate = Number(event.target.value);
    await saveSettings({ speechRate });
    const label = SPEECH_RATES.find((rate) => rate.value === speechRate)?.label ?? '';
    showToast(`読み上げの速さを「${label}」にしました`);
    speak('Good morning.', 'en-US', { rate: speechRate });
    speak('おはようございます', 'ja-JP', { rate: speechRate, queue: true });
  });

  // ---- バックアップを保存 ----
  el.querySelector('#export-btn').addEventListener('click', async () => {
    const now = new Date();
    const data = await exportAllData();
    const backup = makeBackup(data, { appVersion: APP_VERSION, exportedAt: now.toISOString() });
    downloadFile(backupFileName(now), JSON.stringify(backup));
    await saveSettings({ lastBackupAt: backup.exportedAt });
    showToast('バックアップを保存しました');
    refresh();
  });

  // ---- バックアップから戻す ----
  const fileInput = el.querySelector('#import-file');
  el.querySelector('#import-btn').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = ''; // 同じファイルをもう一度選んでも反応するように
    if (!file) return;

    const result = parseBackup(await file.text());
    if (!result.ok) {
      await alertDialog(result.error);
      return;
    }

    const { summary } = result;
    const when = summary.exportedAt ? formatDateTimeJa(new Date(summary.exportedAt)) : '日時不明';
    const ok = await confirmDialog(
      `このバックアップ（${when}）には、単語帳 ${summary.decks}冊・単語 ${summary.cards}語 が入っています。\n\n`
      + `今のデータ（単語帳 ${decks.length}冊・単語 ${totalCards}語）はすべて消えて、バックアップの内容に置き換わります。読み込みますか？`,
      { okLabel: '置き換える', danger: true },
    );
    if (!ok) return;

    try {
      await replaceAllData(result.backup.data);
    } catch (error) {
      console.error(error);
      await alertDialog(`読み込みに失敗しました。今のデータはそのままです。\n（${error.message}）`);
      return;
    }
    // 今のデータは、このバックアップを取った時点と同じになったので、その日時を記録する
    await saveSettings({ lastBackupAt: summary.exportedAt });
    showToast('バックアップから戻しました');
    replaceLocation('#/home');
  });
}
