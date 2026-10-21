/**
 * 問い合わせ管理アプリのフィールド・レイアウト・一覧の定義
 *
 * setup.mjs がこの定義を kintone REST API に送って、アプリを組み立てます。
 * 選択肢（受付経路・種別・優先度・対応状況）は、GAS（gas/Code.gs）と kintone の JS でも同じ値を使います。
 */

const text = (code, label, extra = {}) => ({ type: 'SINGLE_LINE_TEXT', code, label, ...extra });
const multiText = (code, label, extra = {}) => ({ type: 'MULTI_LINE_TEXT', code, label, ...extra });
const dateTime = (code, label, extra = {}) => ({ type: 'DATETIME', code, label, ...extra });
const link = (code, label, protocol) => ({ type: 'LINK', code, label, protocol });
const dropDown = (code, label, choices, defaultValue, extra = {}) => ({
  type: 'DROP_DOWN',
  code,
  label,
  options: Object.fromEntries(choices.map((c, i) => [c, { label: c, index: String(i) }])),
  defaultValue,
  ...extra,
});

export const CHOICES = {
  channel: ['Googleフォーム', 'メール', '電話'],
  category: ['導入のご相談', '見積依頼', '不具合・トラブル', 'その他'],
  priority: ['高', '中', '低'],
  status: ['未対応', '対応中', '完了'],
};

const label = (title) => ({
  type: 'ROW',
  fields: [{ type: 'LABEL', label: `<div><font size="4">${title}</font></div>`, size: { width: '300' } }],
});
const row = (...fields) => ({
  type: 'ROW',
  fields: fields.map(([type, code, width]) => ({ type, code, ...(width ? { size: { width: String(width) } } : {}) })),
});

export const INQUIRY = {
  name: '問い合わせ管理',
  fields: {
    received_at: dateTime('received_at', '受付日時', { required: true, defaultNowValue: true }),
    channel: dropDown('channel', '受付経路', CHOICES.channel, '電話', { required: true }),
    source_id: text('source_id', '連携元ID', { unique: true }), // フォームの回答ID・メールのID（二重登録の防止）
    company: text('company', '会社名'),
    customer_name: text('customer_name', 'お名前', { required: true }),
    email: link('email', 'メールアドレス', 'MAIL'),
    tel: link('tel', '電話番号', 'CALL'),
    category: dropDown('category', '種別', CHOICES.category, 'その他', { required: true }),
    priority: dropDown('priority', '優先度', CHOICES.priority, '中', { required: true }),
    subject: text('subject', '件名'),
    body: multiText('body', '問い合わせ内容', { required: true }),
    status: dropDown('status', '対応状況', CHOICES.status, '未対応', { required: true }),
    assignee: text('assignee', '担当者'),
    due_at: dateTime('due_at', '一次回答期限'),
    response_memo: multiText('response_memo', '対応メモ'),
  },
  layout: [
    label('◆受付'),
    row(['DATETIME', 'received_at'], ['DROP_DOWN', 'channel', 150]),
    // 対応に必要な情報（状況・担当者・期限）は、開いてすぐ目に入るよう上に置く
    label('◆対応'),
    row(['DROP_DOWN', 'status', 130], ['SINGLE_LINE_TEXT', 'assignee', 160], ['DATETIME', 'due_at']),
    row(['MULTI_LINE_TEXT', 'response_memo', 640]),
    label('◆お客様'),
    row(['SINGLE_LINE_TEXT', 'company', 240], ['SINGLE_LINE_TEXT', 'customer_name', 180]),
    row(['LINK', 'email', 240], ['LINK', 'tel', 180]),
    label('◆内容'),
    row(['DROP_DOWN', 'category', 170], ['DROP_DOWN', 'priority', 100]),
    row(['SINGLE_LINE_TEXT', 'subject', 520]),
    row(['MULTI_LINE_TEXT', 'body', 640]),
    label('◆連携情報'),
    row(['SINGLE_LINE_TEXT', 'source_id', 360]),
  ],
  /** レコードのタイトル（パンくずなどに出る名前）は件名にする */
  titleField: 'subject',
  views: {
    対応が必要な問い合わせ: {
      type: 'LIST',
      name: '対応が必要な問い合わせ',
      index: '0',
      fields: ['received_at', 'channel', 'category', 'priority', 'company', 'customer_name', 'subject', 'assignee', 'status', 'due_at'],
      filterCond: 'status in ("未対応", "対応中")',
      sort: 'due_at asc',
    },
    すべての問い合わせ: {
      type: 'LIST',
      name: 'すべての問い合わせ',
      index: '1',
      fields: ['received_at', 'channel', 'category', 'priority', 'company', 'customer_name', 'subject', 'assignee', 'status', 'due_at'],
      sort: 'received_at desc',
    },
  },
};
