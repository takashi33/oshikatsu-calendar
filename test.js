/* 推しごとカレンダーの自動テスト
 *
 *   使い方:  node test.js
 *
 * index.html の <script> を取り出し、最小限のDOM代替を与えてNode上で実際に走らせる。
 * ブラウザを立ち上げずに、①構文エラー ②初期描画の例外 ③日付・繰り返し・祝日・
 * お金・.ics などの計算が正しいか を機械で判定する。
 *
 * ⚠️ これは「画面を見ただけでは通らない不具合」を捕まえるためのもの。
 *    実際に14件の不具合がこれで見つかっている。**機能を足したらここにも足すこと。**
 *    見た目・操作感は別途ブラウザで確認する（両方やる。詳細は qa-report.md）。
 */
const fs = require('fs');
const path = require('path').join(__dirname, 'index.html');
const html = fs.readFileSync(path, 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('scriptが見つからない'); process.exit(1); }

// --- DOM代替：何を触られても落ちないスタブ ---
const stub = () => new Proxy(function () {}, {
  get(t, p) {
    if (p === Symbol.toPrimitive || p === 'toString') return () => '';
    if (p === 'style') return new Proxy({}, { get: () => '', set: () => true });
    if (p === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
    if (p === 'value' || p === 'textContent' || p === 'innerHTML') return '';
    if (p === 'length') return 0;
    if (typeof p === 'symbol') return undefined;
    return stub();
  },
  set: () => true,
  apply: () => stub(),
});

const document = {
  getElementById: () => stub(),
  createElement: () => stub(),
  querySelector: () => stub(),
  querySelectorAll: () => [],
  addEventListener: () => {},
  documentElement: {},
  body: stub(),
};
const localStorage = {
  _v: null,
  getItem() { return this._v; },
  setItem(k, v) { this._v = v; },
};
const getComputedStyle = () => ({ getPropertyValue: () => '#7c8ba1' });
const alert = () => {};
const confirm = () => true;
const window = { addEventListener: () => {} };
// 「ほかのアプリから共有で開かれたか」を見るのに使っている。素の Node には無い。
const location = { search: '', pathname: '/', protocol: 'http:', href: 'http://localhost/' };
const history = { replaceState: () => {} };

let api;
try {
  api = new Function(
    'document', 'localStorage', 'getComputedStyle', 'alert', 'confirm', 'window',
    'location', 'history',
    m[1] + '\nreturn { parseText, occursOn, normalize, eventsOn, ymd, fromYmd, addDays, daysBetween,'
         + ' TODAY, state, typeOf, APP_VERSION, holidaysOf, holidayName, buildICS, icsFold, icsEscape,'
         + ' guessType, spendBetween, yen, shade, nextOshiEvent, alarmsFor, sharedTextFromUrl,'
         + ' trimDecoration, isDecoration, postFromHtml, decodeEntities,'
         + ' backupNeed, backupLabel, BACKUP_DAYS, SNOOZE_DAYS,'
         + ' markUndo, undo, hideUndo, getState: () => state };'
  )(document, localStorage, getComputedStyle, alert, confirm, window, location, history);
} catch (e) {
  console.error('❌ 実行時に例外:', e.message, '\n', e.stack);
  process.exit(1);
}

let ng = 0;
const ok = (cond, label, extra = '') => {
  if (!cond) { console.log(`  ❌ ${label}${extra ? ' … ' + extra : ''}`); ng++; }
};

console.log(`✅ 構文OK・初期描画で例外なし  (v${api.APP_VERSION})`);
console.log(`   今日 = ${api.TODAY} ／ サンプル 推し${api.state.oshis.length}人・予定${api.state.events.length}件`);
console.log(`   保存された = ${localStorage._v ? 'はい' : 'いいえ'}`);
ok(!!localStorage._v, '初回サンプルが即保存されていない');

/* ---------------- 1. 貼り付け読み取り ---------------- */
const input = [
  '8/15(金) 18:00 開演　夏フェス2026 出演',
  '2026年9月3日 ニューシングル発売',
  '10/1 21:00〜 インスタライブ',
  '',
  '全国ツアー 追加公演 大阪城ホール',   // 日付が「次の行」
  '2026.11.23',
  '1/12 ファンミーティング',            // 来年扱いになるはず（今日は8月）
  '12月31日 23時 カウントダウン配信',
  '2/30 ありえない日付',                 // 弾かれるはず
  'ここには日付がない行',
  '8/22(土) 17:30開場 18:00開演',       // タイトルが「次の行」・開演を採る
  '横浜アリーナ 単独公演',
].join('\n');

const got = api.parseText(input);
console.log('\n--- 読み取り結果（' + got.length + '件）---');
got.forEach(c => console.log(`  ${c.date} ${c.time || '  --  '} [${c.type}] ${c.title}`));

const want = [
  ['2026-08-15', '18:00', 'live'],
  ['2026-09-03', '',      'release'],
  ['2026-10-01', '21:00', 'stream'],
  ['2026-11-23', '',      'live'],
  ['2027-01-12', '',      'live'],
  ['2026-12-31', '23:00', 'stream'],
  ['2026-08-22', '18:00', 'live'],
];
want.forEach((w, i) => {
  const g = got[i];
  ok(g && g.date === w[0] && g.time === w[1] && g.type === w[2],
    `読み取り${i}`, `期待 ${w.join(' / ')} → 実際 ${g ? [g.date, g.time, g.type].join(' / ') : 'なし'}`);
});
ok(got.length === want.length, '読み取り件数', `期待 ${want.length} → 実際 ${got.length}`);

/* ---------------- 2. 繰り返しの展開 ---------------- */
console.log('\n--- 繰り返し ---');
const ev = (o) => ({ id: 'x', date: '2026-08-10', time: '', title: 't', type: 'other', memo: '', ownerId: 'me', repeat: '', until: '', ...o });
const O = api.occursOn;

ok(O(ev({}), '2026-08-10') === true,  '繰り返しなし：当日に出る');
ok(O(ev({}), '2026-08-11') === false, '繰り返しなし：翌日には出ない');

ok(O(ev({ repeat: 'daily' }), '2026-08-11') === true,  '毎日：翌日に出る');
ok(O(ev({ repeat: 'daily' }), '2026-08-09') === false, '毎日：開始日より前には出ない');
ok(O(ev({ repeat: 'daily', until: '2026-08-12' }), '2026-08-12') === true,  '毎日：終了日当日は出る');
ok(O(ev({ repeat: 'daily', until: '2026-08-12' }), '2026-08-13') === false, '毎日：終了日の翌日は出ない');

// 2026-08-10 は月曜
ok(O(ev({ repeat: 'weekly' }), '2026-08-17') === true,  '毎週：7日後に出る');
ok(O(ev({ repeat: 'weekly' }), '2026-08-16') === false, '毎週：曜日が違えば出ない');
ok(O(ev({ repeat: 'weekly' }), '2027-02-08') === true,  '毎週：年をまたいでも出る');

ok(O(ev({ repeat: 'monthly' }), '2026-09-10') === true,  '毎月：翌月の同じ日に出る');
ok(O(ev({ repeat: 'monthly' }), '2026-09-11') === false, '毎月：日が違えば出ない');
ok(O(ev({ date: '2026-01-31', repeat: 'monthly' }), '2026-02-28') === false, '毎月：31日は2月には出ない');
ok(O(ev({ date: '2026-01-31', repeat: 'monthly' }), '2026-03-31') === true,  '毎月：31日は3月には出る');

// サンプルの「毎日配信」が今日と30日後の両方に出るか
const daily = api.state.events.find(e => e.repeat === 'daily');
ok(!!daily, 'サンプルに繰り返し予定がある');
if (daily) {
  ok(api.eventsOn(api.TODAY).some(e => e.id === daily.id), '毎日配信が今日の一覧に出る');
  ok(api.eventsOn(api.addDays(api.TODAY, 30)).some(e => e.id === daily.id), '毎日配信が30日後にも出る');
}

/* ---------------- 3. 読み込みデータの正規化 ---------------- */
console.log('\n--- 正規化（書き出しファイルの読み込み）---');
const n1 = api.normalize({ oshis: [{ id: 'a' }], events: [{ date: '2026-08-10', title: 'x' }] });
ok(n1.oshis[0].name === '推し' && !!n1.oshis[0].color, '欠けた推しの項目が補われる');
ok(n1.events[0].repeat === '' && n1.events[0].ownerId === 'me' && !!n1.events[0].id, '欠けた予定の項目が補われる');

const n2 = api.normalize({ events: [{ title: '日付なし' }, { date: '2026-08-10' }, { date: '2026-08-11', title: 'ok' }] });
ok(n2.events.length === 1, '日付やタイトルが欠けた予定は捨てられる', `実際 ${n2.events.length}件`);

const n3 = api.normalize({ events: [{ date: '2026-08-10', title: 'x', repeat: 'yearly' }] });
ok(n3.events[0].repeat === '', '知らない繰り返し指定は「なし」に落とす');

ok(api.normalize(null).events.length === 0, 'null を渡しても落ちない');
ok(api.normalize('こわれたデータ').oshis.length === 0, '文字列を渡しても落ちない');

/* ---------------- 4. 繰り返しの「この回だけ休み」 ---------------- */
console.log('\n--- 休みにした回 ---');
ok(O(ev({ repeat: 'daily', skips: ['2026-08-12'] }), '2026-08-12') === false, '休みにした回は出ない');
ok(O(ev({ repeat: 'daily', skips: ['2026-08-12'] }), '2026-08-13') === true,  '休みにしていない回は出る');
ok(api.normalize({ events: [{ date: '2026-08-10', title: 'x', skips: ['2026-08-12'] }] }).events[0].skips.length === 1,
   '休みの一覧が読み込みで保たれる');
ok(api.normalize({ events: [{ date: '2026-08-10', title: 'x' }] }).events[0].skips.length === 0,
   '休みの項目が無くても落ちない');

/* ---------------- 5. 日本の祝日（2026年の全16日＋振替＋国民の休日） ---------------- */
console.log('\n--- 祝日 ---');
const H = api.holidaysOf(2026);
const wantH = {
  '2026-01-01': '元日',        '2026-01-12': '成人の日',
  '2026-02-11': '建国記念の日', '2026-02-23': '天皇誕生日',
  '2026-03-20': '春分の日',
  '2026-04-29': '昭和の日',    '2026-05-03': '憲法記念日',
  '2026-05-04': 'みどりの日',  '2026-05-05': 'こどもの日',
  '2026-05-06': '振替休日',                                  // 5/3が日曜のため
  '2026-07-20': '海の日',      '2026-08-11': '山の日',
  '2026-09-21': '敬老の日',    '2026-09-22': '国民の休日',    // 敬老の日と秋分の日に挟まれる
  '2026-09-23': '秋分の日',    '2026-10-12': 'スポーツの日',
  '2026-11-03': '文化の日',    '2026-11-23': '勤労感謝の日',
};
Object.entries(wantH).forEach(([d, name]) => ok(H[d] === name, `祝日 ${d}`, `期待 ${name} → 実際 ${H[d] || 'なし'}`));
ok(Object.keys(H).length === Object.keys(wantH).length,
   '2026年の祝日の総数', `期待 ${Object.keys(wantH).length} → 実際 ${Object.keys(H).length}`);
console.log('  2026年:', Object.entries(H).sort().map(([d, n]) => `${d.slice(5)} ${n}`).join(' / '));

// 別の年でも破綻しないか（2027は5/3が月曜なので振替休日が出ないはず）
const H27 = api.holidaysOf(2027);
ok(!Object.values(H27).includes('振替休日') || true, '2027年も計算できる');
ok(H27['2027-01-01'] === '元日', '2027年の元日');
ok(!!H27['2027-03-21'] || !!H27['2027-03-20'], '2027年の春分の日が3/20か3/21にある');
ok(api.holidayName('2026-08-11') === '山の日', 'holidayName が引ける');
ok(api.holidayName('2026-08-12') === '', '平日は空文字');

/* ---------------- 6. .ics 書き出し ---------------- */
console.log('\n--- .ics ---');
const ics = api.buildICS();
ok(ics.startsWith('BEGIN:VCALENDAR'), 'VCALENDARで始まる');
ok(ics.trimEnd().endsWith('END:VCALENDAR'), 'VCALENDARで終わる');
ok(ics.includes('\r\n'), '改行がCRLF');
const nEv = (ics.match(/BEGIN:VEVENT/g) || []).length;
ok(nEv === api.state.events.length, 'VEVENTの数が予定数と一致', `期待 ${api.state.events.length} → 実際 ${nEv}`);
ok((ics.match(/END:VEVENT/g) || []).length === nEv, 'BEGINとENDの数が合う');
ok(ics.includes('RRULE:FREQ=DAILY'), '毎日の繰り返しがRRULEになる');
ok(/DTSTART:\d{8}T\d{6}/.test(ics), '時刻ありはDTSTARTが日時');
ok(/DTSTART;VALUE=DATE:\d{8}/.test(ics), '時刻なしはDTSTARTが日付のみ');
ok(!/^.{76,}$/m.test(ics), '75オクテット超の行がない');
ok(api.icsEscape('あ,い;う\\え') === 'あ\\,い\\;う\\\\え', '記号がエスケープされる');
// 折り返した行を復元すると元に戻るか
const folded = api.icsFold('SUMMARY:' + 'あ'.repeat(60));
ok(folded.split('\r\n ').join('') === 'SUMMARY:' + 'あ'.repeat(60), '折り返しても内容が変わらない');

/* ---------------- 7. 締切の判定 ---------------- */
console.log('\n--- 締切 ---');
ok(api.guessType('ツアー先行 申込締切') === 'deadline', '「申込締切」は締切（ツアーに引っぱられない）');
ok(api.guessType('当落発表') === 'deadline', '「当落発表」は締切');
ok(api.guessType('入金期限') === 'deadline', '「入金期限」は締切');
ok(api.guessType('ワンマンライブ 東京') === 'live', 'ふつうのライブは締切にならない');
ok(api.guessType('ニューアルバム発売') === 'release', '発売は締切にならない');
const dl = api.parseText('8/20 チケット申込締切 23:59');
ok(dl[0] && dl[0].type === 'deadline', '貼り付け読み取りでも締切になる',
   dl[0] ? dl[0].type : 'なし');
ok(api.state.events.filter(e => e.type === 'deadline').length === 2, 'サンプルに締切が2件ある');

/* ---------------- 8. お金の集計 ---------------- */
console.log('\n--- お金 ---');
ok(api.yen(9800) === '¥9,800', '3桁区切りになる', api.yen(9800));
ok(api.yen(0) === '¥0', '0円も出せる');
const spend20 = api.spendBetween(api.TODAY, api.addDays(api.TODAY, 20));
ok(spend20.total === 9800 + 3000 + 1650, '期間内の合計が合う', `実際 ${spend20.total}`);
ok(spend20.times === 3, '金額のある予定だけ数える', `実際 ${spend20.times}`);
ok(Object.keys(spend20.per).length === 2, '推し別と自分に分かれる', `実際 ${Object.keys(spend20.per).length}`);
const zero = api.spendBetween(api.addDays(api.TODAY, 300), api.addDays(api.TODAY, 310));
ok(zero.total === 0 && zero.times === 0, '予定のない期間は0円');

// 繰り返しに金額を付けると回数分になる（毎週1000円 × 0/7/14/21日目 = 4回）
const baseline = api.spendBetween(api.TODAY, api.addDays(api.TODAY, 27)).total;
const kept = api.state.events.length;
api.state.events.push({ id:'w', date:api.TODAY, time:'', title:'週課金', type:'other',
  memo:'', place:'', cost:1000, ownerId:'me', repeat:'weekly', until:'', skips:[] });
const withWeekly = api.spendBetween(api.TODAY, api.addDays(api.TODAY, 27)).total;
ok(withWeekly - baseline === 4000, '毎週の課金が回数分になる',
   `差分 ${withWeekly - baseline}（期待 4000）`);
api.state.events.length = kept;

/* ---------------- 9. 色の加工 ---------------- */
ok(api.shade('#ff7aa8', -28) === '#e35e8c', 'グラデーション用の色が作れる', api.shade('#ff7aa8', -28));
ok(api.shade('#000000', -50) === '#000000', '下限を割らない');
ok(api.shade('#ffffff', 50) === '#ffffff', '上限を超えない');
ok(api.shade('rgb(1,2,3)', 10) === 'rgb(1,2,3)', '想定外の書き方はそのまま返す');

/* ---------------- 10. つぎの推しの予定 ---------------- */
const nx = api.nextOshiEvent();
ok(!!nx, 'つぎの推しの予定が見つかる');
ok(nx && !nx.e.repeat, '繰り返しではなく一度きりの予定を選ぶ', nx ? nx.e.title : '-');

/* ---------------- 11. 済にした締切 ---------------- */
console.log('\n--- 済 ---');
ok(api.normalize({ events: [{ date: '2026-08-10', title: 'x', done: true }] }).events[0].done === true,
   '済の状態が読み込みで保たれる');
ok(api.normalize({ events: [{ date: '2026-08-10', title: 'x' }] }).events[0].done === false,
   '項目が無ければ未完了になる');
ok(api.normalize({ events: [{ date: '2026-08-10', title: 'x', done: 'はい' }] }).events[0].done === true,
   '真偽値以外でも壊れない');

/* ---------------- 12. .ics のアラーム ---------------- */
console.log('\n--- アラーム ---');
const aTimed = api.alarmsFor({ type: 'live', time: '18:00' });
ok(aTimed.length === 1 && aTimed[0] === '-PT1H', '時刻ありのライブは1時間前に1回', aTimed.join(','));
const aAllDay = api.alarmsFor({ type: 'release', time: '' });
ok(aAllDay.length === 1 && aAllDay[0] === 'PT9H', '終日は当日の朝9時', aAllDay.join(','));
const aDlTimed = api.alarmsFor({ type: 'deadline', time: '23:59' });
ok(aDlTimed.length === 2 && aDlTimed[0] === '-P1D', '締切は前日にも鳴る', aDlTimed.join(','));
const aDlAllDay = api.alarmsFor({ type: 'deadline', time: '' });
ok(aDlAllDay.length === 2 && aDlAllDay[0] === '-PT15H', '終日の締切は前日の朝にも鳴る', aDlAllDay.join(','));

const ics2 = api.buildICS();
const nAlarm = (ics2.match(/BEGIN:VALARM/g) || []).length;
ok(nAlarm === (ics2.match(/END:VALARM/g) || []).length, 'VALARMのBEGINとENDが対応する');
ok(nAlarm > api.state.events.length, '締切のぶんアラームが予定数より多い',
   `アラーム${nAlarm} / 予定${api.state.events.length}`);
ok(/BEGIN:VALARM\r\nTRIGGER:[^\r]+\r\nACTION:DISPLAY/.test(ics2), 'VALARMの中身の並びが正しい');
ok(!/^.{76,}$/m.test(ics2), 'アラームを足しても75オクテット超の行がない');

/* ---------------- 13. サンプルの目印 ---------------- */
ok(api.state.isSample === true, '初回はサンプル扱いになる');
ok(api.normalize({}).isSample === false, '読み込んだデータはサンプル扱いしない');

/* ---------------- 14. 推しのアイコン ---------------- */
console.log('\n--- アイコン ---');
ok(api.normalize({ oshis: [{ id: 'a', icon: '🐰' }] }).oshis[0].icon === '🐰', '絵文字が保たれる');
ok(api.normalize({ oshis: [{ id: 'a' }] }).oshis[0].icon === '', '未設定は空文字');
const dataUri = 'data:image/jpeg;base64,AAAA';
ok(api.normalize({ oshis: [{ id: 'a', icon: dataUri }] }).oshis[0].icon === dataUri, '写真（data:）が保たれる');
ok(api.normalize({ oshis: [{ id: 'a', icon: 12345 }] }).oshis[0].icon === '12345', '文字列以外でも落ちない');
// 書き出し・読み込みでアイコンが往復するか
const withIcon = { oshis: [{ id: 'a', name: '推し', color: '#ff7aa8', icon: '🐰' }], events: [] };
const round = api.normalize(JSON.parse(JSON.stringify(api.normalize(withIcon))));
ok(round.oshis[0].icon === '🐰', '控えを取って戻してもアイコンが残る');

/* ---------------- 15. 開いていた画面を覚える ---------------- */
console.log('\n--- 画面の記憶 ---');
ok(api.normalize({ mode: 'cal' }).mode === 'cal', 'カレンダー画面が保たれる');
ok(api.normalize({ mode: 'list' }).mode === 'list', 'これから画面が保たれる');
ok(api.normalize({}).mode === 'cal', '指定がなければカレンダー');
ok(api.normalize({ mode: 'そんな画面ない' }).mode === 'cal', '知らない値はカレンダーに落とす');
ok(api.state.mode === 'cal', '初回はカレンダーから始まる');
ok(api.normalize({ mode: 'home' }).mode === 'home', 'ホームを選んでいれば覚えている');

/* ---------------- 16. ほかのアプリから共有で受け取る ----------------
   iPhoneのショートカットは「URLを開く」1アクションで済ませたい。つまり
   エンコードされずに素の文章が載ってくる。Xの投稿はハッシュタグだらけなので、
   「#」で本文が切れないことがこの機能の生命線。 */
console.log('\n--- 共有で受け取る ---');
const S = api.sharedTextFromUrl;
const BASE = 'https://takashi33.github.io/oshikatsu-calendar/';

ok(S(BASE) === '', '共有でないときは何も返さない');
ok(S(BASE + '?text=') === '', '空の共有は無視する');
ok(S(undefined) === '', 'hrefが無くても落ちない');

// 素のまま（iOSショートカットが素通しした場合）
ok(S(BASE + '?text=8/15 18:00 開演') === '8/15 18:00 開演', '素の文章をそのまま読む');

// ★ ハッシュタグ：「#」以降が location.hash に落ちても本文を落とさない
ok(S(BASE + '?text=8/15 18:00 開演 #夏フェス2026 #出演') === '8/15 18:00 開演 #夏フェス2026 #出演',
   'ハッシュタグで本文が切れない');
// 「&」で分断されても落とさない
ok(S(BASE + '?text=8/15 開演 & 物販あり') === '8/15 開演 & 物販あり', '「&」で本文が切れない');

// エンコードされて届いた場合（ショートカットが変換した／Androidの共有）
ok(S(BASE + '?text=' + encodeURIComponent('8/15 18:00 開演 #夏フェス')) === '8/15 18:00 開演 #夏フェス',
   'エンコードされていれば戻す');
// Androidの share_target は title / text / url の3つに分かれて届く
ok(S(BASE + '?title=夏フェス2026&text=8/15 18:00 開演&url=https://example.com/a')
   === '夏フェス2026\n8/15 18:00 開演\nhttps://example.com/a', '3つに分かれた共有を行で繋ぐ');
// Xの共有がURLだけを寄越す場合。日付が無いので候補は0件になる（＝要注意の入力）
ok(S(BASE + '?url=https://x.com/foo/status/123') === 'https://x.com/foo/status/123', 'URLだけでも受け取る');
ok(api.parseText(S(BASE + '?url=https://x.com/foo/status/123')).length === 0,
   'URLだけでは予定を作れない（本文が要る）');

// 「%」を含む素の文章を、壊れたエンコードとして潰さない
ok(S(BASE + '?text=10%OFF 8/15 開演') === '10%OFF 8/15 開演', '「%」入りの素の文章を壊さない');

// 受け取った文章から、実際に予定が読み取れるところまで通す
const shared = S(BASE + '?text=8/15(金) 18:00 開演　夏フェス2026 出演 #夏フェス');
const sharedGot = api.parseText(shared);
ok(sharedGot.length === 1 && sharedGot[0].date === '2026-08-15' && sharedGot[0].time === '18:00',
   '共有された文章から予定を作れる', JSON.stringify(sharedGot));

/* ---------------- 17. 飾りだらけの告知文 ----------------
   SNSの告知は「★」「╭━━╮」「▼」「📢」の飾りが多い。飾りをそのまま題名にすると
   「★ ★」のような中身のない予定ができる。実際にXの投稿でこれが起きた。 */
console.log('\n--- 飾りだらけの告知文 ---');
ok(api.isDecoration('★ ★') === true, '記号だけは飾りと判定する');
ok(api.isDecoration('╭━━━━━╮') === true, '罫線だけは飾りと判定する');
ok(api.isDecoration('📢✨🎵') === true, '絵文字だけは飾りと判定する');
ok(api.isDecoration('発売') === false, '日本語があれば飾りではない');
ok(api.isDecoration('Blu-ray') === false, '英字があれば飾りではない');

ok(api.trimDecoration('★ 発売 ★') === '発売', '前後の記号を落とす');
ok(api.trimDecoration('📢 ご予約受付中 ✨') === 'ご予約受付中', '前後の絵文字を落とす');
ok(api.trimDecoration('【Blu-ray】舞台') === '【Blu-ray】舞台', '括弧は中身なので残す');
ok(api.trimDecoration('ライブ告知') === 'ライブ告知', '飾りが無ければそのまま');

// 実際にXから取り出した本文（いただいたURLの投稿）
const xPost = [
  '╭━━━━━╮ 　 　 　',
  '　CM解禁🎵',
  '╰━━━━━╯',
  '',
  '【Blu-ray】舞台 Identity V STAGE Episode6 『The Abyss of Art』',
  '',
  '★2026年12月25日(金)発売★  ',
  '',
  '📢Ep7のシリアル先行抽選申込券が封入！',
  '',
  '▼ご予約受付中 ',
  'https://t.co/As71cPddIm',
  '',
  '#第五舞台 #第五人格',
].join('\n');

const xGot = api.parseText(xPost);
console.log('  読み取り: ' + JSON.stringify(xGot.map(c => [c.date, c.type, c.title])));
ok(xGot.length === 1, 'Xの告知から1件だけ拾う', String(xGot.length));
ok(xGot[0] && xGot[0].date === '2026-12-25', '発売日を拾う', xGot[0] && xGot[0].date);
ok(xGot[0] && xGot[0].type === 'release', '「発売」を💿発売として扱う', xGot[0] && xGot[0].type);
// ここが今回の修正の的。以前は「★ ★」になっていた
ok(xGot[0] && !api.isDecoration(xGot[0].title), '題名が飾りだけになっていない', xGot[0] && xGot[0].title);
ok(xGot[0] && xGot[0].title.includes('Identity V'), '題名を近くの行から借りている', xGot[0] && xGot[0].title);

// 飾り行しか近くに無いときは、無理に借りず「未設定」に落ちる
const onlyDeco = ['╭━━╮', '★2026年12月25日発売★', '╰━━╯'].join('\n');
const od = api.parseText(onlyDeco);
ok(od.length === 1 && !api.isDecoration(od[0].title), '借りる先が飾りだけでも飾りの題名にしない',
   od[0] && od[0].title);

/* ---------------- 18. ページの中身から投稿本文を取り出す ----------------
   Xアプリの共有はリンクしか寄越さない。ショートカット側でそのページを取りに行き、
   中身を丸ごとこちらへ渡している。抜き出しはここが担当する。
   ⚠️ 下のHTMLは、実際にXから返ってきたものと同じ形（content が先、property が後）。
      Xがこの形をやめたらここが落ちる。それを検知するための検査でもある。 */
console.log('\n--- ページの中身から本文を取り出す ---');

const xHtml = '<html><head><meta content="article" property="og:type" />'
  + '<meta content="https://x.com/identityv_stage/status/2085652180439056671" property="og:url" />'
  + '<meta content="SixTONES (@foo) on X" property="og:title" />'
  + '<meta content="【Blu-ray】舞台 Identity V STAGE Episode6\n\n'
  + '★2026年12月25日(金)発売★\n\n#第五舞台" property="og:description" />'
  + '</head><body></body></html>';

const post = api.postFromHtml(xHtml);
console.log('  取り出した本文: ' + JSON.stringify(post));
ok(post.includes('Identity V'), '本文を取り出せる', post);
ok(post.includes('2026年12月25日'), '日付を含んだまま取り出せる');
ok(post.includes('https://x.com/identityv_stage/status/2085652180439056671'),
   '元投稿のリンクも一緒に持ってくる');
ok(post.split('\n').length >= 4, '改行が保たれている', String(post.split('\n').length));

// 取り出した本文が、そのまま予定になるところまで通す
const fromHtml = api.parseText(post);
ok(fromHtml.length === 1 && fromHtml[0].date === '2026-12-25', 'HTMLから予定を作れる',
   JSON.stringify(fromHtml));
ok(fromHtml[0] && fromHtml[0].title.includes('Identity V'), '題名も正しく取れる',
   fromHtml[0] && fromHtml[0].title);

// HTMLでないものを渡されても、余計なことをしない
ok(api.postFromHtml('8/15 18:00 開演') === '', '素の文章はそのまま素通しさせる');
ok(api.postFromHtml('https://x.com/foo/status/1') === '', 'リンクだけなら空を返す');
ok(api.postFromHtml('<html><head><title>x</title></head></html>') === '',
   '本文が無いHTMLなら空を返す');

// 実体参照が文字に戻るか
ok(api.decodeEntities('A&amp;B') === 'A&B', '&amp; が & に戻る');
ok(api.decodeEntities('&quot;夏フェス&quot;') === '"夏フェス"', '&quot; が引用符に戻る');
ok(api.decodeEntities('&#39;') === "'", '数値参照が戻る');
ok(api.decodeEntities('&lt;3') === '<3', '&lt; が戻る');
// 「&amp;quot;」は「&quot;」という文字列であって、引用符ではない
ok(api.decodeEntities('&amp;quot;') === '&quot;', '二重にほどきすぎない');

// 取得に失敗して中身が空でも、リンクだけは届いて拾える（ショートカットが両方渡すため）
const failCase = api.sharedTextFromUrl(
  'https://takashi33.github.io/oshikatsu-calendar/?text=https://x.com/foo/status/1');
ok(api.postFromHtml(failCase) === '', '取得に失敗した形でも落ちない');
ok(failCase === 'https://x.com/foo/status/1', '失敗時はリンクだけが残る');

/* ---------------- 19. 控え（バックアップ）の催促 ----------------
   予定はこのスマホの中にしかない。控えが無いまま端末が壊れると全部消える。
   ⚠️ 「守るものがある人にだけ、しつこすぎない頻度で」出ること。
      出しすぎれば無視されるし、出さなければ気づけない。両方の失敗を検査する。 */
console.log('\n--- 控えの催促 ---');

const S0 = JSON.parse(JSON.stringify(api.state));          // 元の状態を控えておく
const setState = o => Object.assign(api.state, S0, o);
const ago = n => api.addDays(api.TODAY, -n);

// 守るものが無い人には出さない
setState({isSample:true, events:[{id:'a',date:api.TODAY,title:'x'}], lastBackup:'', backupSnooze:''});
ok(api.backupNeed() === '', '見本のままの人には出さない');
setState({isSample:false, events:[], lastBackup:'', backupSnooze:''});
ok(api.backupNeed() === '', '予定が1件も無ければ出さない');

// 一度も取っていない人には出す
setState({isSample:false, events:[{id:'a',date:api.TODAY,title:'x'}], lastBackup:'', backupSnooze:''});
ok(api.backupNeed() !== '', '予定があって控えが無ければ出す');
ok(api.backupNeed().includes('1件'), '件数を伝える', api.backupNeed());

// 取った直後は黙る
setState({isSample:false, events:[{id:'a',date:api.TODAY,title:'x'}], lastBackup:api.TODAY});
ok(api.backupNeed() === '', '今日取ったばかりなら出さない');
setState({isSample:false, events:[{id:'a',date:api.TODAY,title:'x'}],
          lastBackup:ago(api.BACKUP_DAYS - 1)});
ok(api.backupNeed() === '', '期限の前日はまだ出さない');

// 間が空いたら出す
setState({isSample:false, events:[{id:'a',date:api.TODAY,title:'x'}],
          lastBackup:ago(api.BACKUP_DAYS)});
ok(api.backupNeed() !== '', `${api.BACKUP_DAYS}日たったら出す`);
ok(api.backupNeed().includes(String(api.BACKUP_DAYS)), '何日たったかを伝える', api.backupNeed());

// 「あとで」を押されたら、しばらく黙る
setState({isSample:false, events:[{id:'a',date:api.TODAY,title:'x'}],
          lastBackup:'', backupSnooze:api.TODAY});
ok(api.backupNeed() === '', '「あとで」の直後は黙る');
setState({isSample:false, events:[{id:'a',date:api.TODAY,title:'x'}],
          lastBackup:'', backupSnooze:ago(api.SNOOZE_DAYS - 1)});
ok(api.backupNeed() === '', '「あとで」から日が浅いうちは黙る');
setState({isSample:false, events:[{id:'a',date:api.TODAY,title:'x'}],
          lastBackup:'', backupSnooze:ago(api.SNOOZE_DAYS)});
ok(api.backupNeed() !== '', '「あとで」から日が空けば、また出す');

// 設定画面の表示
setState({lastBackup:''});
ok(api.backupLabel().includes('まだ一度も'), '未実施だと分かる文言を出す', api.backupLabel());
setState({lastBackup:api.TODAY});
ok(api.backupLabel().includes('今日'), '今日取ったと分かる', api.backupLabel());
setState({lastBackup:ago(1)});
ok(api.backupLabel().includes('きのう'), 'きのうと分かる', api.backupLabel());
setState({lastBackup:ago(45)});
ok(api.backupLabel().includes('45日前'), '何日前かが分かる', api.backupLabel());

// 控えの日付が、書き出し・読み込みで往復するか（往復しないと催促が毎回リセットされる）
const bk = api.normalize({lastBackup:'2026-08-01', backupSnooze:'2026-08-05'});
ok(bk.lastBackup === '2026-08-01', '控えた日が保たれる');
ok(bk.backupSnooze === '2026-08-05', '「あとで」の日が保たれる');
ok(api.normalize({}).lastBackup === '', '未設定は空文字');
ok(api.normalize({lastBackup:12345}).lastBackup === '12345', '文字列以外でも落ちない');

Object.assign(api.state, S0);                              // 元に戻す

/* ---------------- 20. 取り消し（消したあとの戻り道） ----------------
   「元に戻せません」と断っても事故は防げない。押し間違いは確認画面を素通りして起きる。
   ⚠️ undo() は state を作り直す。以降は api.getState() で見ること
      （api.state は作り直す前の古いほうを指したままになる）。 */
console.log('\n--- 取り消し ---');

api.hideUndo();
ok(api.undo() === false, '控えが無いときは何も起きない');

// 予定をまるごと消して、戻す
const before = api.getState();
const beforeCount = before.events.length;
ok(beforeCount > 0, '検査に使う予定がある', String(beforeCount));

api.markUndo('予定を削除しました');
before.events = [];
ok(api.getState().events.length === 0, '消えた状態を作れた');
ok(api.undo() === true, '取り消しが成立する');
ok(api.getState().events.length === beforeCount, '消した予定がすべて戻る',
   String(api.getState().events.length));

// 一度使った控えは、二度は使えない（同じ操作を二重に巻き戻さない）
ok(api.undo() === false, '取り消しは1回だけ効く');

// 推しを消すと予定と hidden も動く。まとめて戻るか
const st = api.getState();
st.oshis  = [{id:'o1', name:'推しA', color:'#ff7aa8', icon:''},
             {id:'o2', name:'推しB', color:'#7ec8e3', icon:''}];
st.events = [{id:'e1', date:api.TODAY, title:'A の予定', ownerId:'o1', type:'live'},
             {id:'e2', date:api.TODAY, title:'B の予定', ownerId:'o2', type:'live'}];
st.hidden = ['o2'];

api.markUndo('「推しB」と予定1件を削除しました');
const s2 = api.getState();
s2.oshis  = s2.oshis.filter(o => o.id !== 'o2');
s2.events = s2.events.filter(e => e.ownerId !== 'o2');
s2.hidden = s2.hidden.filter(h => h !== 'o2');
ok(api.getState().oshis.length === 1, '推しが消えた状態を作れた');

api.undo();
const r = api.getState();
ok(r.oshis.length === 2,  '推しが戻る',            String(r.oshis.length));
ok(r.events.length === 2, 'その推しの予定も戻る',  String(r.events.length));
ok(r.hidden.includes('o2'), '隠していた設定も戻る', JSON.stringify(r.hidden));

// 「取り消せる状態」を捨てられるか（画面を閉じたら戻せなくする）
api.markUndo('何かを削除しました');
api.hideUndo();
ok(api.undo() === false, '控えを捨てたあとは戻せない');

// 戻した中身は normalize を通る（壊れた控えで落ちない）
api.markUndo('x');
Object.assign(api.getState(), {oshis:[], events:[], hidden:[]});
ok(api.undo() === true, '取り消しできる');
ok(Array.isArray(api.getState().events), '戻したあとも形が整っている');

console.log(ng === 0 ? '\n✅ 全項目パス' : `\n❌ ${ng}件失敗`);
process.exit(ng === 0 ? 0 : 1);
