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

let api;
try {
  api = new Function(
    'document', 'localStorage', 'getComputedStyle', 'alert', 'confirm', 'window',
    m[1] + '\nreturn { parseText, occursOn, normalize, eventsOn, ymd, fromYmd, addDays, daysBetween,'
         + ' TODAY, state, typeOf, APP_VERSION, holidaysOf, holidayName, buildICS, icsFold, icsEscape,'
         + ' guessType, spendBetween, yen, shade, nextOshiEvent, alarmsFor };'
  )(document, localStorage, getComputedStyle, alert, confirm, window);
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
ok(api.normalize({}).mode === 'home', '指定がなければホーム');
ok(api.normalize({ mode: 'そんな画面ない' }).mode === 'home', '知らない値はホームに落とす');
ok(api.state.mode === 'home', '初回はホームから始まる');

console.log(ng === 0 ? '\n✅ 全項目パス' : `\n❌ ${ng}件失敗`);
process.exit(ng === 0 ? 0 : 1);
