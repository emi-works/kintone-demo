/**
 * 請求管理アプリ カスタマイズ（common.js の後に読み込む）
 *
 * このファイルでやっていること：
 *   1. 明細を入力すると、税率ごとの小計・消費税・合計を自動計算（インボイス制度対応）
 *   2. 支払期限を「請求日の翌月末」で自動設定
 *   3. 保存時に請求番号を自動採番（INV-2026-0001）※見積から作った請求書は作成時に採番済み
 *   4. 「請求書を印刷」ボタンで A4 の請求書（登録番号・税率ごとの消費税・振込先入り）を表示・印刷
 *   5. 一覧で、支払期限を過ぎた未入金の請求を赤く表示
 */
(() => {
  'use strict';

  const QI = window.QuoteInvoice;

  const UNPAID = '未入金';

  /** JS が値を入れるので、手入力させないフィールド */
  const READ_ONLY_FIELDS = [...QI.AMOUNT_FIELDS, 'invoice_no', 'quote_no', 'quote_record_id'];

  // ================================================================
  // 入力画面：金額の自動計算・支払期限
  // ================================================================

  kintone.events.on(['app.record.create.show', 'app.record.edit.show'], (event) => {
    const { record } = event;

    if (event.type === 'app.record.create.show') {
      // 「再利用」で作った請求書は、番号や見積との紐付けを引き継がない
      if (event.reuse) {
        ['invoice_no', 'quote_no', 'quote_record_id'].forEach((code) => { record[code].value = ''; });
        record.payment_status.value = UNPAID;
      }
      if (!record.due_date.value && record.invoice_date.value) {
        record.due_date.value = QI.endOfNextMonth(record.invoice_date.value);
      }
    }

    READ_ONLY_FIELDS.forEach((code) => { record[code].disabled = true; });
    kintone.app.record.setFieldShown('quote_record_id', false);
    QI.applyTotals(record);
    return event;
  });

  // 請求日を変えたら、支払期限を翌月末に合わせる
  kintone.events.on(['app.record.create.change.invoice_date', 'app.record.edit.change.invoice_date'], (event) => {
    const { record } = event;
    if (record.invoice_date.value) record.due_date.value = QI.endOfNextMonth(record.invoice_date.value);
    return event;
  });

  // 明細が変わったら計算し直す
  kintone.events.on(QI.amountChangeEvents(), (event) => {
    QI.applyTotals(event.record);
    return event;
  });

  // ================================================================
  // 保存時：チェックと採番
  // ================================================================

  kintone.events.on(['app.record.create.submit', 'app.record.edit.submit'], async (event) => {
    const { record } = event;
    QI.applyTotals(record);

    if (!record.items.value.some(({ value: r }) => r.item_name.value)) {
      event.error = '明細を1行以上入力してください。';
      return event;
    }

    if (!record.invoice_no.value) {
      record.invoice_no.value = await QI.nextNumber({
        appId: kintone.app.getId(),
        field: 'invoice_no',
        prefix: 'INV',
        dateString: record.invoice_date.value || QI.today(),
      });
    }
    return event;
  });

  // ================================================================
  // 詳細画面：印刷と見積へのリンク
  // ================================================================

  kintone.events.on('app.record.detail.show', (event) => {
    const { record } = event;
    kintone.app.record.setFieldShown('quote_record_id', false);

    const bar = QI.prepareToolbar();
    if (!bar) return event;

    bar.appendChild(QI.createButton('請求書を印刷', () => QI.openPrintPreview('invoice', record), 'qi-btn--primary'));
    if (record.quote_record_id.value) {
      const link = QI.el('a', 'qi-link', `元の見積 ${record.quote_no.value} を開く →`);
      link.href = QI.recordUrl(QI.APP_ID.QUOTE, record.quote_record_id.value);
      bar.appendChild(link);
    }
    return event;
  });

  // ================================================================
  // 一覧画面：支払期限を過ぎた未入金を赤く表示
  // ================================================================

  kintone.events.on('app.record.index.show', (event) => {
    if (event.viewType !== 'list') return event;
    const cells = kintone.app.getFieldElements('due_date');
    if (!cells) return event;

    const todayString = QI.today();
    event.records.forEach((record, i) => {
      const cell = cells[i];
      if (!cell) return;
      const row = cell.closest('tr') || cell;
      const overdue = record.payment_status.value === UNPAID
        && record.due_date.value && record.due_date.value < todayString; // YYYY-MM-DD は文字列のまま比較できる
      row.classList.toggle('qi-row--overdue', Boolean(overdue));
      cell.querySelector('.qi-badge')?.remove();
      if (overdue) (cell.firstElementChild || cell).appendChild(QI.el('span', 'qi-badge', '期限超過'));
    });
    return event;
  });
})();
