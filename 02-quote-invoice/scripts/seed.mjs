/**
 * デモデータを登録するスクリプト
 *
 * 見積10件と、そのうち「請求済み」の見積から作った請求3件を登録します。
 * 日付は実行した日を基準にするので、いつ実行しても「期限超過」などの見え方が再現できます。
 * 二重登録を防ぐため、見積管理アプリにレコードがあるときは何もしません。
 *
 * 使い方: node scripts/seed.mjs
 */
import { APPS, api } from './kintone.mjs';

// ---------------- 計算（js/common.js の calcTotals と同じルール） ----------------

const RATES = { '10%': 10, '8%（軽減）': 8 };
const lineAmount = (qty, price) => Math.floor(Number(qty) * Number(price) + 1e-7);
const calcTotals = (items) => {
  const base = { 10: 0, 8: 0 };
  items.forEach(([, qty, , price, rate]) => { base[RATES[rate]] += lineAmount(qty, price); });
  const tax10 = Math.floor((base[10] * 10) / 100);
  const tax8 = Math.floor((base[8] * 8) / 100);
  return {
    subtotal_10: base[10], tax_10: tax10, subtotal_8: base[8], tax_8: tax8,
    subtotal: base[10] + base[8], tax_total: tax10 + tax8, total: base[10] + base[8] + tax10 + tax8,
  };
};

// ---------------- 日付 ----------------

const pad2 = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return fmt(d); };
const endOfNextMonth = (s) => { const [y, m] = s.split('-').map(Number); return fmt(new Date(y, m + 1, 0)); };
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return fmt(new Date(y, m - 1, d + n)); };

// ---------------- デモデータ ----------------

const T = '10%';
const R = '8%（軽減）';

// [品目, 数量, 単位, 単価, 税率]
const QUOTES = [
  {
    customer: '株式会社サンプル商事', contact: '山田 太郎', subject: '勤怠管理アプリ構築', rep: '営業 太郎', status: '請求済み', date: -70,
    items: [['要件定義・業務ヒアリング', 1, '式', 300000, T], ['kintoneアプリ構築（勤怠・申請）', 1, '式', 900000, T], ['操作研修（オンライン）', 2, '回', 50000, T]],
    invoice: { date: -40, status: '入金済み' },
  },
  {
    customer: '有限会社みどり運輸', contact: '佐藤 花子', subject: '日報アプリ導入支援', rep: '営業 花子', status: '請求済み', date: -100,
    items: [['日報アプリ構築', 1, '式', 450000, T], ['既存Excelデータの移行', 1, '式', 80000, T]],
    invoice: { date: -80, status: '未入金' }, // 支払期限を過ぎた未入金（一覧で赤くなる）
  },
  {
    customer: '株式会社北斗食品', contact: '高橋 美咲', subject: '在庫管理アプリ構築と現場研修', rep: '営業 次郎', status: '請求済み', date: -30,
    items: [
      ['在庫管理アプリ構築', 1, '式', 1200000, T],
      ['追加開発（帳票出力）', 2.5, '人日', 60000, T],
      ['現場研修（2時間×2回）', 2, '回', 60000, T],
      ['研修用 お弁当', 24, '個', 1080, R],
      ['研修用 お茶（ペットボトル）', 24, '本', 160, R],
    ],
    invoice: { date: -5, status: '未入金' },
  },
  {
    customer: '株式会社あおば製作所', contact: '田中 健', subject: '問い合わせ管理アプリ構築', rep: '営業 花子', status: '受注', date: -12,
    items: [['問い合わせ管理アプリ構築', 1, '式', 600000, T], ['Googleフォーム連携（GAS）', 1, '式', 200000, T], ['Chatwork通知設定', 1, '式', 50000, T]],
  },
  {
    customer: '税理士法人さくら会計', contact: '伊藤 直子', subject: '契約書管理の電子化', rep: '営業 太郎', status: '受注', date: -8,
    items: [['契約書管理アプリ構築', 1, '式', 500000, T], ['既存PDFの登録作業', 120, '件', 500, T], ['操作マニュアル作成', 1, '式', 80000, T]],
  },
  {
    customer: '株式会社ミライ人材', contact: '渡辺 翔', subject: '採用管理アプリ導入', rep: '営業 次郎', status: '提出済み', date: -6,
    items: [['採用管理アプリ構築', 1, '式', 400000, T], ['応募フォーム連携', 1, '式', 150000, T]],
  },
  {
    customer: '一般社団法人みらい教育協会', contact: '吉田 拓也', subject: '研修申込管理アプリと説明会', rep: '営業 花子', status: '提出済み', date: -4,
    items: [
      ['研修申込管理アプリ構築', 1, '式', 700000, T],
      ['会員向け説明会の運営', 1, '回', 100000, T],
      ['説明会用 軽食（サンドイッチ）', 40, '個', 540, R],
      ['説明会用 飲料', 40, '本', 150, R],
    ],
  },
  {
    customer: '株式会社ひかり不動産', contact: '鈴木 一郎', subject: '物件問い合わせのkintone連携', rep: '営業 太郎', status: '作成中', date: -1,
    items: [['Webフォーム→kintone連携', 1, '式', 250000, T], ['担当者への自動通知', 1, '式', 60000, T]],
  },
  {
    customer: '株式会社たちばな商店', contact: '橋本 剛', subject: '販売管理の刷新', rep: '営業 次郎', status: '失注', date: -50,
    items: [['販売管理アプリ構築', 1, '式', 1300000, T], ['データ移行', 1, '式', 200000, T]],
  },
  {
    customer: '株式会社ふじ観光', contact: '松本 大輔', subject: 'クレーム対応履歴アプリ', rep: '営業 花子', status: '作成中', date: 0,
    items: [['クレーム対応履歴アプリ構築', 1, '式', 350000, T], ['操作研修', 1, '回', 50000, T]],
  },
];

// ---------------- kintone の形式に変換 ----------------

const v = (value) => ({ value: String(value) });
const itemsValue = (items) => ({
  value: items.map(([name, qty, unit, price, rate]) => ({
    value: { item_name: v(name), item_qty: v(qty), item_unit: v(unit), item_price: v(price), item_tax_rate: v(rate) },
  })),
});
const amountValues = (items) => Object.fromEntries(Object.entries(calcTotals(items)).map(([k, n]) => [k, v(n)]));

try {
  const { totalCount } = await api(APPS.quote, '/k/v1/records.json', 'GET', { app: APPS.quote.id, totalCount: true, fields: ['$id'] });
  if (Number(totalCount) > 0) {
    console.log(`見積管理アプリにすでに ${totalCount} 件あるため、登録しませんでした。`);
    process.exit(0);
  }

  const year = day(0).slice(0, 4);
  const quoteRecords = QUOTES.map((q, i) => {
    const quoteDate = day(q.date);
    return {
      quote_no: v(`Q-${year}-${String(i + 1).padStart(4, '0')}`),
      status: v(q.status === '請求済み' ? '受注' : q.status), // 請求済みは請求書を作ってから付ける
      quote_date: v(quoteDate),
      valid_until: v(addDays(quoteDate, 30)),
      customer_name: v(q.customer),
      customer_contact: v(q.contact),
      subject: v(q.subject),
      sales_rep: v(q.rep),
      items: itemsValue(q.items),
      ...amountValues(q.items),
    };
  });
  const { ids: quoteIds } = await api(APPS.quote, '/k/v1/records.json', 'POST', { app: APPS.quote.id, records: quoteRecords });
  console.log(`見積を ${quoteIds.length} 件登録しました`);

  // 「請求済み」の見積から請求書を作り、見積側にも請求番号を書き戻す
  let seq = 0;
  for (const [i, q] of QUOTES.entries()) {
    if (!q.invoice) continue;
    seq += 1;
    const invoiceNo = `INV-${year}-${String(seq).padStart(4, '0')}`;
    const invoiceDate = day(q.invoice.date);
    const { id } = await api(APPS.invoice, '/k/v1/record.json', 'POST', {
      app: APPS.invoice.id,
      record: {
        invoice_no: v(invoiceNo),
        payment_status: v(q.invoice.status),
        invoice_date: v(invoiceDate),
        due_date: v(endOfNextMonth(invoiceDate)),
        customer_name: v(q.customer),
        customer_contact: v(q.contact),
        subject: v(q.subject),
        sales_rep: v(q.rep),
        items: itemsValue(q.items),
        ...amountValues(q.items),
        quote_no: quoteRecords[i].quote_no,
        quote_record_id: v(quoteIds[i]),
      },
    });
    await api(APPS.quote, '/k/v1/record.json', 'PUT', {
      app: APPS.quote.id,
      id: quoteIds[i],
      record: { invoice_no: v(invoiceNo), invoice_record_id: v(id), status: v('請求済み') },
    });
    console.log(`請求 ${invoiceNo} を登録しました（${q.customer}）`);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
