/**
 * 見積管理・請求管理 共通ライブラリ
 *
 * 見積管理アプリ・請求管理アプリの両方で、quote.js / invoice.js より先に読み込みます。
 * window.QuoteInvoice に、次の機能をまとめています。
 *   - インボイス制度に沿った税率ごとの金額計算（端数は切り捨て）
 *   - 年ごとの自動採番（Q-2026-0001 / INV-2026-0001）
 *   - 日付の計算（30日後、翌月末）
 *   - A4 帳票（見積書・請求書）の表示と印刷
 */
(() => {
  'use strict';

  // ================================================================
  // 設定
  // ================================================================

  /** アプリID（アプリを作り直したときはここを変える） */
  const APP_ID = {
    QUOTE: 2,
    INVOICE: 3,
  };

  /** 税率（明細の「税率」ドロップダウンの選択肢と一致させる）。計算誤差を避けるため % の整数で持つ */
  const TAX_RATES = {
    '10%': 10,
    '8%（軽減）': 8,
  };
  const REDUCED_RATE = '8%（軽減）';

  /** 帳票に載せる自社情報（デモ用の架空の会社） */
  const ISSUER = {
    name: 'サンプル株式会社',
    zip: '〒100-0000',
    address: '東京都千代田区サンプル町1-2-3 サンプルビル5F',
    tel: 'TEL 03-0000-0000',
    registrationNo: 'T1234567890123', // 適格請求書発行事業者の登録番号（架空）
    bank: 'サンプル銀行 本店営業部 普通 1234567　口座名義：サンプル株式会社',
  };

  // ================================================================
  // 金額計算（インボイス制度：税率ごとに合計してから消費税を1回だけ計算する）
  // ================================================================

  const toNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  /** 明細1行の金額（円未満切り捨て）。小数の掛け算の誤差で 1 円ずれないよう、わずかに足してから切り捨てる */
  const lineAmount = (qty, price) => Math.floor(toNumber(qty) * toNumber(price) + 1e-7);

  /**
   * 明細から、税率ごとの対象額・消費税・合計を計算する
   * @param {Array} rows サブテーブルの行（kintone の形式：[{ value: { item_qty: {value}, ... } }]）
   */
  const calcTotals = (rows) => {
    const base = { 10: 0, 8: 0 };
    rows.forEach(({ value: row }) => {
      const rate = TAX_RATES[row.item_tax_rate.value] ?? TAX_RATES['10%'];
      base[rate] += lineAmount(row.item_qty.value, row.item_price.value);
    });
    // 消費税は「税率ごとの合計額 × 税率」を1回だけ計算し、端数を切り捨てる（明細ごとに計算しない）
    const tax10 = Math.floor((base[10] * 10) / 100);
    const tax8 = Math.floor((base[8] * 8) / 100);
    return {
      subtotal_10: base[10],
      tax_10: tax10,
      subtotal_8: base[8],
      tax_8: tax8,
      subtotal: base[10] + base[8],
      tax_total: tax10 + tax8,
      total: base[10] + base[8] + tax10 + tax8,
    };
  };

  /** 計算結果をレコードの金額欄に入れる */
  const applyTotals = (record) => {
    const totals = calcTotals(record.items.value);
    Object.entries(totals).forEach(([code, value]) => {
      record[code].value = String(value);
    });
    return totals;
  };

  /** 金額欄（JS が計算するので手入力させない）のフィールドコード */
  const AMOUNT_FIELDS = ['subtotal_10', 'tax_10', 'subtotal_8', 'tax_8', 'subtotal', 'tax_total', 'total'];

  /** 明細のどれかが変わったら計算し直すためのイベント名を作る */
  const amountChangeEvents = (screens = ['create', 'edit']) => screens.flatMap((screen) => (
    ['items', 'item_qty', 'item_price', 'item_tax_rate'].map((code) => `app.record.${screen}.change.${code}`)
  ));

  // ================================================================
  // 自動採番
  // ================================================================

  /**
   * 「接頭辞-年-4桁の連番」の次の番号を返す（例：Q-2026-0007）
   * 同じ年の最大の番号を REST API で調べて +1 する。
   * ※ 同時に保存した場合に重複しないよう、番号のフィールドは「値の重複を禁止」にしてある
   */
  const nextNumber = async ({ appId, field, prefix, dateString }) => {
    const head = `${prefix}-${dateString.slice(0, 4)}-`;
    const resp = await kintone.api(kintone.api.url('/k/v1/records.json', true), 'GET', {
      app: appId,
      query: `${field} like "${head}" order by ${field} desc limit 1`,
      fields: [field],
    });
    const last = resp.records[0] ? resp.records[0][field].value : '';
    const lastSeq = last.startsWith(head) ? Number(last.slice(head.length)) || 0 : 0;
    return `${head}${String(lastSeq + 1).padStart(4, '0')}`;
  };

  // ================================================================
  // 日付
  // ================================================================

  const pad2 = (n) => String(n).padStart(2, '0');
  const toDateString = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const parseDate = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const today = () => toDateString(new Date());

  /** n 日後 */
  const addDays = (dateString, n) => {
    const d = parseDate(dateString);
    d.setDate(d.getDate() + n);
    return toDateString(d);
  };

  /** 翌月末（例：2026-10-21 → 2026-11-30）。日付 0 は「前の月の末日」になる仕組みを使う */
  const endOfNextMonth = (dateString) => {
    const d = parseDate(dateString);
    return toDateString(new Date(d.getFullYear(), d.getMonth() + 2, 0));
  };

  /** 帳票用の表記（2026年10月21日） */
  const formatDateJa = (dateString) => {
    if (!dateString) return '';
    const d = parseDate(dateString);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  };

  const formatYen = (value) => `¥${toNumber(value).toLocaleString('ja-JP')}`;

  // ================================================================
  // 帳票（A4 の見積書・請求書）
  // ================================================================

  /** 要素を作る小さな関数（文字は textContent で入れて、HTML として解釈させない） */
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  };

  /** 帳票の種類ごとの文言 */
  const DOC_TYPES = {
    quote: {
      title: '御見積書',
      noLabel: '見積番号',
      noField: 'quote_no',
      dateLabel: '見積日',
      dateField: 'quote_date',
      subDateLabel: '有効期限',
      subDateField: 'valid_until',
      lead: '下記のとおりお見積り申し上げます。',
      totalLabel: 'お見積金額',
    },
    invoice: {
      title: '請求書',
      noLabel: '請求番号',
      noField: 'invoice_no',
      dateLabel: '請求日',
      dateField: 'invoice_date',
      subDateLabel: 'お支払期限',
      subDateField: 'due_date',
      lead: '下記のとおりご請求申し上げます。',
      totalLabel: 'ご請求金額',
    },
  };

  /** レコードから A4 1枚分の帳票を組み立てる */
  const buildDocument = (type, record) => {
    const t = DOC_TYPES[type];
    const v = (code) => (record[code] ? record[code].value : '');
    const sheet = el('div', 'qi-sheet');

    // 見出しと番号・日付
    sheet.appendChild(el('h1', 'qi-title', t.title));
    const meta = el('dl', 'qi-meta');
    [[t.noLabel, v(t.noField)], [t.dateLabel, formatDateJa(v(t.dateField))], [t.subDateLabel, formatDateJa(v(t.subDateField))]]
      .forEach(([k, val]) => {
        meta.appendChild(el('dt', null, k));
        meta.appendChild(el('dd', null, val));
      });
    sheet.appendChild(meta);

    // 宛先と発行元
    const head = el('div', 'qi-head');
    const to = el('div', 'qi-to');
    to.appendChild(el('p', 'qi-customer', `${v('customer_name')} 御中`));
    if (v('customer_contact')) to.appendChild(el('p', 'qi-contact', `${v('customer_contact')} 様`));
    to.appendChild(el('p', 'qi-subject', `件名：${v('subject')}`));
    to.appendChild(el('p', 'qi-lead', t.lead));
    const total = el('div', 'qi-total-box');
    total.appendChild(el('span', 'qi-total-label', t.totalLabel));
    total.appendChild(el('span', 'qi-total-value', `${formatYen(v('total'))}（税込）`));
    to.appendChild(total);
    head.appendChild(to);

    const from = el('div', 'qi-from');
    from.appendChild(el('p', 'qi-issuer', ISSUER.name));
    [ISSUER.zip, ISSUER.address, ISSUER.tel, `登録番号：${ISSUER.registrationNo}`].forEach((line) => {
      from.appendChild(el('p', null, line));
    });
    if (v('sales_rep')) from.appendChild(el('p', null, `担当：${v('sales_rep')}`));
    head.appendChild(from);
    sheet.appendChild(head);

    // 明細表（軽減税率の品目には ※ を付ける：適格請求書の記載事項）
    const table = el('table', 'qi-items');
    const thead = el('thead');
    const hr = el('tr');
    ['品目', '数量', '単位', '単価', '金額'].forEach((h) => hr.appendChild(el('th', null, h)));
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el('tbody');
    record.items.value.forEach(({ value: r }) => {
      const tr = el('tr');
      const reduced = r.item_tax_rate.value === REDUCED_RATE;
      tr.appendChild(el('td', 'qi-name', `${r.item_name.value}${reduced ? ' ※' : ''}`));
      tr.appendChild(el('td', 'qi-num', toNumber(r.item_qty.value).toLocaleString('ja-JP')));
      tr.appendChild(el('td', 'qi-unit', r.item_unit.value));
      tr.appendChild(el('td', 'qi-num', formatYen(r.item_price.value)));
      tr.appendChild(el('td', 'qi-num', formatYen(lineAmount(r.item_qty.value, r.item_price.value))));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    sheet.appendChild(table);

    // 税率ごとの合計（適格請求書の記載事項）
    const sums = el('table', 'qi-sums');
    const sumRows = [
      ['小計（税抜）', v('subtotal')],
      ['10%対象', v('subtotal_10'), '消費税', v('tax_10')],
      ['8%対象', v('subtotal_8'), '消費税', v('tax_8')],
      ['合計（税込）', v('total')],
    ];
    sumRows.forEach(([k1, v1, k2, v2]) => {
      const tr = el('tr');
      tr.appendChild(el('th', null, k1));
      tr.appendChild(el('td', 'qi-num', formatYen(v1)));
      if (k2) {
        tr.appendChild(el('th', null, k2));
        tr.appendChild(el('td', 'qi-num', formatYen(v2)));
      } else {
        const filler = el('td');
        filler.colSpan = 2;
        tr.appendChild(filler);
      }
      sums.appendChild(tr);
    });
    sheet.appendChild(sums);
    sheet.appendChild(el('p', 'qi-footnote', '※は軽減税率（8%）対象品目です。'));

    // 振込先（請求書のみ）と備考
    if (type === 'invoice') {
      const bank = el('div', 'qi-box');
      bank.appendChild(el('p', 'qi-box-title', 'お振込先'));
      bank.appendChild(el('p', null, ISSUER.bank));
      bank.appendChild(el('p', 'qi-small', '恐れ入りますが、振込手数料は貴社にてご負担ください。'));
      sheet.appendChild(bank);
    }
    if (v('note')) {
      const note = el('div', 'qi-box');
      note.appendChild(el('p', 'qi-box-title', '備考'));
      note.appendChild(el('p', 'qi-note', v('note')));
      sheet.appendChild(note);
    }
    return sheet;
  };

  /** 帳票を画面に重ねて表示する（「印刷する」でブラウザの印刷・PDF保存へ） */
  const openPrintPreview = (type, record) => {
    document.getElementById('qi-print-overlay')?.remove();
    const overlay = el('div');
    overlay.id = 'qi-print-overlay';

    const toolbar = el('div', 'qi-print-toolbar');
    const printBtn = el('button', 'qi-btn qi-btn--primary', '印刷する / PDFで保存');
    printBtn.type = 'button';
    printBtn.addEventListener('click', () => window.print());
    const closeBtn = el('button', 'qi-btn', '閉じる');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', () => overlay.remove());
    toolbar.append(printBtn, closeBtn);

    overlay.append(toolbar, buildDocument(type, record));
    document.body.appendChild(overlay);
  };

  // ================================================================
  // 画面の部品
  // ================================================================

  /** ボタンを作る */
  const createButton = (label, onClick, modifier = '') => {
    const button = el('button', `qi-btn ${modifier}`.trim(), label);
    button.type = 'button';
    button.addEventListener('click', onClick);
    return button;
  };

  /** 詳細画面のヘッダーに、ボタンなどを並べる入れ物を用意する（再表示で増えないよう作り直す） */
  const prepareToolbar = () => {
    const space = kintone.app.record.getHeaderMenuSpaceElement();
    if (!space) return null;
    document.getElementById('qi-toolbar')?.remove();
    const bar = el('div', 'qi-toolbar');
    bar.id = 'qi-toolbar';
    space.appendChild(bar);
    return bar;
  };

  /** 他のアプリのレコード画面の URL */
  const recordUrl = (appId, recordId) => `/k/${appId}/show#record=${recordId}`;

  window.QuoteInvoice = {
    APP_ID,
    AMOUNT_FIELDS,
    calcTotals,
    applyTotals,
    amountChangeEvents,
    nextNumber,
    today,
    addDays,
    endOfNextMonth,
    buildDocument,
    openPrintPreview,
    createButton,
    prepareToolbar,
    recordUrl,
    el,
  };
})();
