/**
 * 見積管理・請求管理アプリのフィールド・レイアウト・一覧の定義
 *
 * setup.mjs がこの定義を kintone REST API に送って、アプリを組み立てます。
 * 見積→請求の転記をシンプルにするため、両アプリで共通の項目は同じフィールドコードにしています。
 */

// ---------------- 部品 ----------------

const text = (code, label, extra = {}) => ({ type: 'SINGLE_LINE_TEXT', code, label, ...extra });
const multiText = (code, label) => ({ type: 'MULTI_LINE_TEXT', code, label });
const date = (code, label, extra = {}) => ({ type: 'DATE', code, label, ...extra });
const yen = (code, label) => ({
  type: 'NUMBER', code, label, digit: true, unit: '円', unitPosition: 'AFTER',
});
const dropDown = (code, label, choices, defaultValue, extra = {}) => ({
  type: 'DROP_DOWN',
  code,
  label,
  options: Object.fromEntries(choices.map((c, i) => [c, { label: c, index: String(i) }])),
  defaultValue,
  ...extra,
});

/** 税率の選択肢（JS の TAX_RATES と同じ値にする） */
export const TAX_RATE_CHOICES = ['10%', '8%（軽減）'];

/** 明細（サブテーブル）：見積・請求で共通 */
const items = {
  type: 'SUBTABLE',
  code: 'items',
  label: '明細',
  fields: {
    item_name: text('item_name', '品目'),
    item_qty: { type: 'NUMBER', code: 'item_qty', label: '数量' }, // 小数桁は指定しない（2.5 などは入力どおり表示）
    item_unit: text('item_unit', '単位'),
    item_price: yen('item_price', '単価'),
    item_tax_rate: dropDown('item_tax_rate', '税率', TAX_RATE_CHOICES, '10%'),
    // 金額は行ごとの計算なので kintone の計算フィールドに任せる（税率ごとの集計は JS）
    item_amount: {
      type: 'CALC',
      code: 'item_amount',
      label: '金額',
      expression: 'ROUNDDOWN(item_qty * item_price, 0)',
      format: 'NUMBER_DIGIT',
      unit: '円',
      unitPosition: 'AFTER',
    },
  },
};

/** 金額欄：JS が税率ごとに計算して入れる（共通） */
const amounts = {
  subtotal_10: yen('subtotal_10', '10%対象（税抜）'),
  tax_10: yen('tax_10', '消費税（10%）'),
  subtotal_8: yen('subtotal_8', '8%対象（税抜）'),
  tax_8: yen('tax_8', '消費税（8%）'),
  subtotal: yen('subtotal', '小計（税抜）'),
  tax_total: yen('tax_total', '消費税合計'),
  total: yen('total', '合計（税込）'),
};

/** 両アプリ共通の基本項目 */
const common = {
  customer_name: text('customer_name', '顧客名', { required: true }),
  customer_contact: text('customer_contact', '顧客担当者'),
  subject: text('subject', '件名', { required: true }),
  sales_rep: text('sales_rep', '自社担当者'),
  items,
  ...amounts,
  note: multiText('note', '備考'),
};

// ---------------- レイアウト用の部品 ----------------

const label = (title) => ({
  type: 'ROW',
  fields: [{ type: 'LABEL', label: `<div><font size="4">${title}</font></div>`, size: { width: '300' } }],
});
const row = (...fields) => ({
  type: 'ROW',
  fields: fields.map(([type, code, width]) => ({ type, code, ...(width ? { size: { width: String(width) } } : {}) })),
});
const itemsLayout = {
  type: 'SUBTABLE',
  code: 'items',
  fields: [
    { type: 'SINGLE_LINE_TEXT', code: 'item_name', size: { width: '280' } },
    { type: 'NUMBER', code: 'item_qty', size: { width: '80' } },
    { type: 'SINGLE_LINE_TEXT', code: 'item_unit', size: { width: '70' } },
    { type: 'NUMBER', code: 'item_price', size: { width: '130' } },
    { type: 'DROP_DOWN', code: 'item_tax_rate', size: { width: '120' } },
    { type: 'CALC', code: 'item_amount', size: { width: '140' } },
  ],
};
const amountsLayout = [
  label('◆金額（税率ごとに自動計算）'),
  row(['NUMBER', 'subtotal_10', 180], ['NUMBER', 'tax_10', 180]),
  row(['NUMBER', 'subtotal_8', 180], ['NUMBER', 'tax_8', 180]),
  row(['NUMBER', 'subtotal', 180], ['NUMBER', 'tax_total', 180], ['NUMBER', 'total', 200]),
];

// ---------------- 見積管理 ----------------

export const QUOTE = {
  name: '見積管理',
  fields: {
    quote_no: text('quote_no', '見積番号', { unique: true }),
    status: dropDown('status', 'ステータス', ['作成中', '提出済み', '受注', '失注', '請求済み'], '作成中', { required: true }),
    quote_date: date('quote_date', '見積日', { required: true, defaultNowValue: true }),
    valid_until: date('valid_until', '有効期限'),
    ...common,
    invoice_no: text('invoice_no', '請求番号'),
    invoice_record_id: text('invoice_record_id', '請求レコードID'),
  },
  layout: [
    label('◆基本情報'),
    row(['SINGLE_LINE_TEXT', 'quote_no', 180], ['DROP_DOWN', 'status', 150]),
    row(['DATE', 'quote_date'], ['DATE', 'valid_until']),
    row(['SINGLE_LINE_TEXT', 'customer_name', 260], ['SINGLE_LINE_TEXT', 'customer_contact', 180]),
    row(['SINGLE_LINE_TEXT', 'subject', 460], ['SINGLE_LINE_TEXT', 'sales_rep', 160]),
    label('◆明細'),
    itemsLayout,
    ...amountsLayout,
    label('◆備考'),
    row(['MULTI_LINE_TEXT', 'note', 640]),
    label('◆請求との連携'),
    row(['SINGLE_LINE_TEXT', 'invoice_no', 180], ['SINGLE_LINE_TEXT', 'invoice_record_id', 120]),
  ],
  views: {
    すべての見積: {
      type: 'LIST',
      name: 'すべての見積',
      index: '0',
      fields: ['quote_no', 'quote_date', 'customer_name', 'subject', 'sales_rep', 'status', 'total', 'invoice_no'],
      sort: 'quote_no desc',
    },
  },
};

// ---------------- 請求管理 ----------------

export const INVOICE = {
  name: '請求管理',
  fields: {
    invoice_no: text('invoice_no', '請求番号', { unique: true }),
    payment_status: dropDown('payment_status', '入金状況', ['未入金', '入金済み'], '未入金', { required: true }),
    invoice_date: date('invoice_date', '請求日', { required: true, defaultNowValue: true }),
    due_date: date('due_date', '支払期限', { required: true }),
    ...common,
    quote_no: text('quote_no', '見積番号'),
    quote_record_id: text('quote_record_id', '見積レコードID'),
  },
  layout: [
    label('◆基本情報'),
    row(['SINGLE_LINE_TEXT', 'invoice_no', 180], ['DROP_DOWN', 'payment_status', 150]),
    row(['DATE', 'invoice_date'], ['DATE', 'due_date']),
    row(['SINGLE_LINE_TEXT', 'customer_name', 260], ['SINGLE_LINE_TEXT', 'customer_contact', 180]),
    row(['SINGLE_LINE_TEXT', 'subject', 460], ['SINGLE_LINE_TEXT', 'sales_rep', 160]),
    label('◆明細'),
    itemsLayout,
    ...amountsLayout,
    label('◆備考'),
    row(['MULTI_LINE_TEXT', 'note', 640]),
    label('◆見積との連携'),
    row(['SINGLE_LINE_TEXT', 'quote_no', 180], ['SINGLE_LINE_TEXT', 'quote_record_id', 120]),
  ],
  views: {
    すべての請求: {
      type: 'LIST',
      name: 'すべての請求',
      index: '0',
      fields: ['invoice_no', 'invoice_date', 'due_date', 'customer_name', 'subject', 'total', 'payment_status', 'quote_no'],
      sort: 'invoice_no desc',
    },
  },
};
