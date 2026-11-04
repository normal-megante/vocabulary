// =========================================================
// 読み上げ
//
// スマホに入っている音声読み上げ（ブラウザの speechSynthesis）を使う。
// お金もインターネットもいらない。声の種類や読み方の自然さは、スマホによって違う。
//
// ・単語帳ごとに「表の言語」（frontLang）・「裏の言語」（backLang）・「自動で読む」（autoSpeak）
// ・アプリ全体で「読む速さ」（speechRate）
//
// 言語を決める計算（detectLang・langFor・deckLang など）は、ブラウザなしでテストできる。
// tests/speech.test.mjs で動きを確かめられる。
// =========================================================

// 単語帳の設定で選べる言語（'auto'＝文字を見て決める、'off'＝読まない）
export const SPEECH_LANGS = [
  { id: 'auto', label: '自動（文字を見て決める）' },
  { id: 'en-US', label: '英語' },
  { id: 'ja-JP', label: '日本語' },
  { id: 'ko-KR', label: '韓国語' },
  { id: 'zh-CN', label: '中国語' },
  { id: 'fr-FR', label: 'フランス語' },
  { id: 'de-DE', label: 'ドイツ語' },
  { id: 'es-ES', label: 'スペイン語' },
  { id: 'off', label: '読まない' },
];

// アルファベットを使う言語（「自動」でアルファベットだったときに、どの言語で読むかを決めるため）
const LATIN_LANGS = ['en-US', 'fr-FR', 'de-DE', 'es-ES'];

// 読む速さ（設定画面で選ぶ）
export const SPEECH_RATES = [
  { value: 0.7, label: 'ゆっくり' },
  { value: 1, label: 'ふつう' },
  { value: 1.3, label: 'はやい' },
];

// 言語の名前（'en-US' → '英語'）
export function langLabel(lang) {
  return SPEECH_LANGS.find((item) => item.id === lang)?.label ?? lang;
}

// ---------------------------------------------------------
// 文字を見て、読む言語を決める
//   latin : アルファベットだったときに使う言語（ふつうは英語）
//   → 'ja-JP' など（読む文字がなければ null）
// 漢字だけのときは日本語として読む（中国語で読みたい単語帳は、設定で「中国語」を選ぶ）。
// ---------------------------------------------------------
export function detectLang(text, latin = 'en-US') {
  const s = String(text ?? '');
  if (!s.trim()) return null;
  if (/[぀-ヿㇰ-ㇿｦ-ﾟ]/.test(s)) return 'ja-JP'; // ひらがな・カタカナ
  if (/[가-힯ᄀ-ᇿ㄰-㆏]/.test(s)) return 'ko-KR'; // ハングル
  if (/[㐀-䶿一-鿿]/.test(s)) return 'ja-JP'; // 漢字
  if (/[A-Za-zÀ-ɏ]/.test(s)) return latin; // アルファベット
  return 'ja-JP'; // 数字や記号だけ
}

// 設定（'auto' / 'off' / 'en-US' など）と文字から、読む言語を決める（読まないときは null）
export function langFor(text, setting = 'auto', latin = 'en-US') {
  if (!String(text ?? '').trim() || setting === 'off') return null;
  if (!setting || setting === 'auto') return detectLang(text, latin);
  return setting;
}

// この単語帳で、アルファベットを何語で読むか
// （表か裏でアルファベットの言語を選んでいればその言語、なければ英語）
export function latinLangOf(deck) {
  return [deck.frontLang, deck.backLang].find((lang) => LATIN_LANGS.includes(lang)) ?? 'en-US';
}

// 単語帳の表・裏・例文を読む言語（読まないときは null）
//   side : 'front'（表）/ 'back'（裏）/ 'example'（例文。いつも文字を見て決める）
export function deckLang(deck, side, text) {
  const latin = latinLangOf(deck);
  if (side === 'example') return langFor(text, 'auto', latin);
  return langFor(text, side === 'front' ? deck.frontLang : deck.backLang, latin);
}

// 読み上げる文字を整える（「〜」は読まない、「/」は区切りとして少し間をあける）
export function speechTextOf(text) {
  return String(text ?? '')
    .replace(/[〜~]/g, ' ')
    .replace(/[/／]/g, '、')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------
// ここから下はブラウザで動かす部分
// ---------------------------------------------------------

// このブラウザで読み上げができるか
export function canSpeak() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

// 声の一覧は、あとから読み込まれることがあるので、先に頼んでおく
if (canSpeak()) window.speechSynthesis.getVoices();

// 言語に合う声をさがす（見つからなければ、ブラウザにまかせる）
function voiceFor(lang) {
  const voices = window.speechSynthesis.getVoices();
  const key = (voice) => voice.lang.replace('_', '-').toLowerCase();
  const want = lang.toLowerCase();
  const base = want.split('-')[0];
  return voices.find((voice) => key(voice) === want && voice.localService)
    ?? voices.find((voice) => key(voice) === want)
    ?? voices.find((voice) => key(voice).split('-')[0] === base)
    ?? null;
}

// 読み上げる
//   queue : true なら、いま読んでいるものの後に続けて読む（false なら、いま読んでいるものを止めて読む）
//   → 読み上げを始められたか
export function speak(text, lang, { rate = 1, queue = false } = {}) {
  const words = speechTextOf(text);
  if (!canSpeak() || !lang || !words) return false;
  const synth = window.speechSynthesis;
  if (!queue && (synth.speaking || synth.pending)) synth.cancel();
  const utterance = new SpeechSynthesisUtterance(words);
  utterance.lang = lang;
  utterance.rate = rate;
  const voice = voiceFor(lang);
  if (voice) utterance.voice = voice;
  synth.speak(utterance);
  return true;
}

// 読み上げを止める
export function stopSpeaking() {
  if (canSpeak() && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
    window.speechSynthesis.cancel();
  }
}
