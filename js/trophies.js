// =========================================================
// トロフィーと称号
//
// ・トロフィー：条件を満たすと1回だけもらえて、コインもつく。一度取ったら消えない。
//   取ったトロフィーは通帳（wallet）に 'trophy:streak3' のような id で記録する（コインといっしょ）。
// ・称号：取ったトロフィーの数で上がる（トロフィーは消えないので、称号も下がらない）。
// ・ひみつのトロフィー（secret）は、取るまで名前と条件を「？？？」にする。
// ・トロフィーの種類・条件の数・コインは、下の TROPHIES を書き換えれば変えられる。
//   （称号のいちばん上は、トロフィーを全部取ったときにする）
//
// 画面やデータ保存とは関係のない「計算だけ」のファイル。
// tests/trophies.test.mjs で動きを確かめられる。
// =========================================================
import { GOAL_LABEL } from './defaults.js';
import { addDays } from './srs.js';

// 「しっかり覚えた単語」の段階（段階5＝前の問題から2週間あけても覚えていた単語）
export const MASTERED_LEVEL = 5;

// 「早起き」になる時間（朝4時〜6時前に、今日のきょうのぶんを達成。夜中の2時などは早起きにしない）
export const EARLY_FROM = 4;
export const EARLY_HOUR = 6;

export const TROPHY_GROUPS = [
  { key: 'streak', icon: '🔥', name: '続ける' },
  { key: 'stamp', icon: '★', name: 'スタンプ' },
  { key: 'bingo', icon: '🎯', name: 'ビンゴ' },
  { key: 'study', icon: '📚', name: '学習' },
  { key: 'secret', icon: '🌙', name: 'ひみつ' },
];

// stat：どの数で判定するか（trophyStats の項目）、target：いくつ以上で取れるか、coins：もらえるコイン
export const TROPHIES = [
  { key: 'streak3', group: 'streak', name: '3日連続', about: '3日続けてスタンプ（💤 もOK）', stat: 'longestStreak', target: 3, coins: 5 },
  { key: 'streak7', group: 'streak', name: '7日連続', about: '7日続けてスタンプ（💤 もOK）', stat: 'longestStreak', target: 7, coins: 10 },
  { key: 'streak14', group: 'streak', name: '14日連続', about: '14日続けてスタンプ（💤 もOK）', stat: 'longestStreak', target: 14, coins: 15 },
  { key: 'streak30', group: 'streak', name: '30日連続', about: '30日続けてスタンプ（💤 もOK）', stat: 'longestStreak', target: 30, coins: 30 },
  { key: 'streak100', group: 'streak', name: '100日連続', about: '100日続けてスタンプ（💤 もOK）', stat: 'longestStreak', target: 100, coins: 100 },
  { key: 'stamp1', group: 'stamp', name: 'はじめてのスタンプ', about: '全体のスタンプを1つもらう', stat: 'stamps', target: 1, coins: 5 },
  { key: 'stamp30', group: 'stamp', name: 'スタンプ30個', about: '全体のスタンプを30個あつめる', stat: 'stamps', target: 30, coins: 20 },
  { key: 'gold1', group: 'stamp', name: 'はじめての金色', about: '金色のスタンプを1つもらう', stat: 'golds', target: 1, coins: 10 },
  { key: 'bingo1', group: 'bingo', name: 'はじめてのビンゴ', about: 'スタンプカードで縦か横を1列そろえる', stat: 'bingoLines', target: 1, coins: 5 },
  { key: 'perfect', group: 'bingo', name: '1か月パーフェクト', about: '1か月ぜんぶのスタンプをそろえる', stat: 'perfectMonths', target: 1, coins: 50 },
  { key: 'answer100', group: 'study', name: '合計100問', about: '解いた問題が合計100問', stat: 'answered', target: 100, coins: 5 },
  { key: 'answer1000', group: 'study', name: '合計1,000問', about: '解いた問題が合計1,000問', stat: 'answered', target: 1000, coins: 20 },
  { key: 'answer5000', group: 'study', name: '合計5,000問', about: '解いた問題が合計5,000問', stat: 'answered', target: 5000, coins: 50 },
  { key: 'mastered50', group: 'study', name: 'しっかり覚えた50語', about: '2週間あけても覚えていた単語が50語', stat: 'mastered', target: 50, coins: 20 },
  { key: 'choice100', group: 'study', name: '4択で100問正解', about: '4択の正解が合計100問', stat: 'choiceCorrect', target: 100, coins: 10 },
  { key: 'nightOwl', group: 'secret', secret: true, name: '夜ふかし', about: `夜中に、昨日の「${GOAL_LABEL}」を達成する`, stat: 'nightOwl', target: 1, coins: 5 },
  { key: 'earlyBird', group: 'secret', secret: true, name: '早起き', about: `朝${EARLY_FROM}時〜${EARLY_HOUR}時に「${GOAL_LABEL}」を達成する`, stat: 'earlyBird', target: 1, coins: 5 },
  { key: 'donmai', group: 'secret', secret: true, name: 'ドンマイ', about: 'はじめてお休みチケットを使う', stat: 'restDays', target: 1, coins: 5 },
];

// 数の単位（「あと◯日」などの表示用）
export const STAT_UNITS = {
  longestStreak: '日', stamps: '個', golds: '個', bingoLines: '本', perfectMonths: '回',
  answered: '問', mastered: '語', choiceCorrect: '問', nightOwl: '回', earlyBird: '回', restDays: '回',
};

// 称号（count：必要なトロフィーの数）
export const TITLES = [
  { count: 0, name: 'はじめの一歩' },
  { count: 3, name: '見習い' },
  { count: 6, name: 'がんばりや' },
  { count: 10, name: 'ものしり' },
  { count: 14, name: '単語はかせ' },
  { count: 18, name: '単語マスター' },
];

// ---------------------------------------------------------
// いちばん長く続いた連続日数
//   dates：スタンプかお休みのある日（'2026-11-04' の形）の Set か配列
// ---------------------------------------------------------
export function longestStreak(dates) {
  const sorted = [...new Set(dates)].sort();
  let best = 0;
  let run = 0;
  let previous = null;
  for (const date of sorted) {
    run = previous && addDays(previous, 1) === date ? run + 1 : 1;
    best = Math.max(best, run);
    previous = date;
  }
  return best;
}

// ---------------------------------------------------------
// トロフィーの判定に使う数をまとめる
//   stampList     : 全体のスタンプ（stamps 棚）
//   walletEntries : 通帳（ビンゴ・お休みの記録を見る）
//   dailyList     : 日ごとの学習記録
//   progressList  : 覚え具合の記録
//   events        : いま起きたこと（'nightOwl' 夜ふかし・'earlyBird' 早起き）
// ---------------------------------------------------------
export function trophyStats({ stampList = [], walletEntries = [], dailyList = [], progressList = [], events = [] }) {
  const restDates = walletEntries.filter((e) => e.type === 'use' && e.item === 'rest').map((e) => e.date);
  const bingos = walletEntries.filter((e) => e.type === 'bingo');
  return {
    longestStreak: longestStreak([...stampList.map((s) => s.date), ...restDates]),
    stamps: stampList.length,
    golds: stampList.filter((s) => s.gold).length,
    bingoLines: bingos.filter((e) => e.line !== 'all').length,
    perfectMonths: bingos.filter((e) => e.line === 'all').length,
    answered: dailyList.reduce((sum, d) => sum + (d.answered ?? 0), 0),
    choiceCorrect: dailyList.reduce((sum, d) => sum + (d.choice ?? 0), 0),
    mastered: new Set(progressList.filter((p) => (p.level ?? 0) >= MASTERED_LEVEL).map((p) => p.cardId)).size,
    restDays: restDates.length,
    nightOwl: events.includes('nightOwl') ? 1 : 0,
    earlyBird: events.includes('earlyBird') ? 1 : 0,
  };
}

// 「きょうのぶん」を達成したときに起きたこと（ひみつのトロフィー用）
//   late：夜中に前の日の分として数えていたか
export function achievementEvents({ late, now = new Date() }) {
  if (late) return ['nightOwl'];
  const hour = now.getHours();
  if (hour >= EARLY_FROM && hour < EARLY_HOUR) return ['earlyBird'];
  return [];
}

// 通帳から、取ったトロフィー（key → 取った時刻）
export function ownedTrophies(walletEntries) {
  const owned = new Map();
  for (const entry of walletEntries) {
    if (entry.type === 'trophy') owned.set(entry.trophy, entry.at);
  }
  return owned;
}

// 新しく取れるトロフィー（まだ持っていなくて、条件を満たしているもの）
export function newTrophies(stats, owned) {
  return TROPHIES.filter((trophy) => !owned.has(trophy.key) && (stats[trophy.stat] ?? 0) >= trophy.target);
}

// 通帳の1行にする
export function trophyEntry(trophy, at = Date.now()) {
  return { id: `trophy:${trophy.key}`, type: 'trophy', trophy: trophy.key, coins: trophy.coins, at };
}

// いまの称号と、次の称号
//   → { name, count（その称号に必要な数）, next: { name, count } か null（いちばん上） }
export function titleOf(count) {
  let index = 0;
  TITLES.forEach((title, i) => {
    if (count >= title.count) index = i;
  });
  return { name: TITLES[index].name, count: TITLES[index].count, next: TITLES[index + 1] ?? null };
}

// トロフィーを取ったときのお知らせの文（称号が上がったら、それも）
//   ownedBefore：取る前に持っていたトロフィーの数
export function trophyMessages(found, ownedBefore) {
  if (found.length === 0) return [];
  const coins = found.reduce((sum, trophy) => sum + trophy.coins, 0);
  const secret = found.length === 1 && found[0].secret ? 'ひみつの' : '';
  const messages = [found.length <= 2
    ? `🏆 ${secret}トロフィー「${found.map((t) => t.name).join('」「')}」ゲット！ 🪙${coins}`
    : `🏆 トロフィーを${found.length}個ゲット！ 🪙${coins}`];
  const before = titleOf(ownedBefore).name;
  const after = titleOf(ownedBefore + found.length).name;
  if (before !== after) messages.push(`🎖 称号が「${after}」になりました！`);
  return messages;
}
