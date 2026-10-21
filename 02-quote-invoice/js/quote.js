/**
 * 見積管理アプリ カスタマイズ（common.js の後に読み込む）
 *
 * 解決したい困りごと：
 *   「見積書から請求書を作るとき、同じ内容を何度も手入力している」
 *
 * このファイルでやっていること：
 *   1. 明細を入力すると、税率ごとの小計・消費税・合計を自動計算（インボイス制度対応）
 *   2. 保存時に見積番号を自動採番（Q-2026-0001）
 *   3. 「請求書を作成」ボタン1つで、請求管理アプリに明細ごと転記（REST API）
 *   4. 「見積書を印刷」ボタンで A4 の見積書を表示・印刷・PDF保存
 */
(() => {
  'use strict';

  const QI = window.QuoteInvoice;

  /** ステータス（ドロップダウンの選択肢と一致させる） */
  const STATUS = {
    DRAFT: '作成中',
    WON: '受注',
    INVOICED: '請求済み',
  };

  /** 見積の有効期限：見積日から何日後にするか */
  const VALID_DAYS = 30;

  /** JS が値を入れるので、手入力させないフィールド */
  const READ_ONLY_FIELDS = [...QI.AMOUNT_FIELDS, 'quote_no', 'invoice_no', 'invoice_record_id'];

  // ================================================================
  // 入力画面：金額の自動計算・初期値
  // ================================================================

  kintone.events.on(['app.record.create.show', 'app.record.edit.show'], (event) => {
    const { record } = event;

    // 「再利用」で作った見積は、番号や請求との紐付けを引き継がない
    if (event.type === 'app.record.create.show') {
      if (event.reuse) {
        ['quote_no', 'invoice_no', 'invoice_record_id'].forEach((code) => { record[code].value = ''; });
        record.status.value = STATUS.DRAFT;
      }
      if (!record.valid_until.value && record.quote_date.value) {
        record.valid_until.value = QI.addDays(record.quote_date.value, VALID_DAYS);
      }
    }

    READ_ONLY_FIELDS.forEach((code) => { record[code].disabled = true; });
    kintone.app.record.setFieldShown('invoice_record_id', false);
    QI.applyTotals(record);
    return event;
  });

  // 見積日を変えたら、有効期限も合わせる（新規作成時のみ）
  kintone.events.on('app.record.create.change.quote_date', (event) => {
    const { record } = event;
    if (record.quote_date.value) record.valid_until.value = QI.addDays(record.quote_date.value, VALID_DAYS);
    return event;
  });

  // 明細（行の追加・削除、数量・単価・税率）が変わったら計算し直す
  kintone.events.on(QI.amountChangeEvents(), (event) => {
    QI.applyTotals(event.record);
    return event;
  });

  // ================================================================
  // 保存時：チェックと採番
  // ================================================================

  /** 保存前のチェック。エラーがあればメッセージを返す */
  const validate = (record) => {
    const rows = record.items.value.filter(({ value: r }) => r.item_name.value);
    if (rows.length === 0) return '明細を1行以上入力してください。';
    if (record.status.value === STATUS.INVOICED && !record.invoice_no.value) {
      return '「請求済み」は、詳細画面の「請求書を作成」ボタンで自動的に設定されます。';
    }
    return null;
  };

  kintone.events.on(['app.record.create.submit', 'app.record.edit.submit'], async (event) => {
    const { record } = event;
    QI.applyTotals(record);

    const error = validate(record);
    if (error) {
      event.error = error;
      return event;
    }

    // 新規作成時だけ見積番号を振る（同じ年の最大番号 + 1）
    if (!record.quote_no.value) {
      record.quote_no.value = await QI.nextNumber({
        appId: kintone.app.getId(),
        field: 'quote_no',
        prefix: 'Q',
        dateString: record.quote_date.value || QI.today(),
      });
    }
    return event;
  });

  // 一覧で直接ステータスを「請求済み」にされないようにする
  kintone.events.on('app.record.index.edit.submit', (event) => {
    const { record } = event;
    if (record.status.value === STATUS.INVOICED && !record.invoice_no.value) {
      event.error = '「請求済み」は、詳細画面の「請求書を作成」ボタンで自動的に設定されます。';
    }
    return event;
  });

  // ================================================================
  // 詳細画面：請求書の作成（アプリ間の転記）と印刷
  // ================================================================

  /** 見積レコードから、請求管理アプリに登録するレコードを作る */
  const toInvoiceRecord = (quote, invoiceNo, quoteId) => {
    const invoiceDate = QI.today();
    // 明細は、計算フィールド（金額）を除いた入力項目だけをコピーする
    const items = quote.items.value
      .filter(({ value: r }) => r.item_name.value)
      .map(({ value: r }) => ({
        value: {
          item_name: { value: r.item_name.value },
          item_qty: { value: r.item_qty.value },
          item_unit: { value: r.item_unit.value },
          item_price: { value: r.item_price.value },
          item_tax_rate: { value: r.item_tax_rate.value },
        },
      }));
    const totals = QI.calcTotals(items);

    const copy = (code) => ({ value: quote[code].value });
    return {
      invoice_no: { value: invoiceNo },
      payment_status: { value: '未入金' },
      invoice_date: { value: invoiceDate },
      due_date: { value: QI.endOfNextMonth(invoiceDate) },
      customer_name: copy('customer_name'),
      customer_contact: copy('customer_contact'),
      subject: copy('subject'),
      sales_rep: copy('sales_rep'),
      note: copy('note'),
      items: { value: items },
      ...Object.fromEntries(Object.entries(totals).map(([code, value]) => [code, { value: String(value) }])),
      quote_no: copy('quote_no'),
      quote_record_id: { value: String(quoteId) },
    };
  };

  /**
   * 請求書を作成する
   *   1. 最新の見積を読み直して、すでに請求書がないか確認（二重作成の防止）
   *   2. 請求番号を採番して、請求管理アプリにレコードを追加
   *   3. 見積に請求番号を書き込み、ステータスを「請求済み」にする
   */
  const createInvoice = async (button) => {
    const quoteId = kintone.app.record.getId();
    button.disabled = true;
    try {
      const { record: quote } = await kintone.api(kintone.api.url('/k/v1/record.json', true), 'GET', {
        app: kintone.app.getId(),
        id: quoteId,
      });
      if (quote.invoice_no.value) {
        alert(`この見積からは、すでに請求書（${quote.invoice_no.value}）が作成されています。`);
        return;
      }
      if (!window.confirm(`見積 ${quote.quote_no.value} から請求書を作成します。よろしいですか？`)) return;

      const invoiceNo = await QI.nextNumber({
        appId: QI.APP_ID.INVOICE,
        field: 'invoice_no',
        prefix: 'INV',
        dateString: QI.today(),
      });
      const { id: invoiceId } = await kintone.api(kintone.api.url('/k/v1/record.json', true), 'POST', {
        app: QI.APP_ID.INVOICE,
        record: toInvoiceRecord(quote, invoiceNo, quoteId),
      });

      try {
        await kintone.api(kintone.api.url('/k/v1/record.json', true), 'PUT', {
          app: kintone.app.getId(),
          id: quoteId,
          revision: quote.$revision.value, // 読み直した後に誰かが更新していたらエラーにする
          record: {
            invoice_no: { value: invoiceNo },
            invoice_record_id: { value: String(invoiceId) },
            status: { value: STATUS.INVOICED },
          },
        });
      } catch (error) {
        // 請求書はできているので、その旨を伝える（見積側は手で直してもらう）
        alert(`請求書 ${invoiceNo} は作成しましたが、見積の更新に失敗しました。\n${error.message || ''}`);
        error.handled = true; // 下の catch で二重にメッセージを出さない
        throw error;
      }

      alert(`請求書 ${invoiceNo} を作成しました。`);
      window.location.reload();
    } catch (error) {
      console.error(error);
      if (!error.handled) alert(`請求書を作成できませんでした。\n${error.message || ''}`);
    } finally {
      button.disabled = false;
    }
  };

  kintone.events.on('app.record.detail.show', (event) => {
    const { record } = event;
    kintone.app.record.setFieldShown('invoice_record_id', false);

    const bar = QI.prepareToolbar();
    if (!bar) return event;

    bar.appendChild(QI.createButton('見積書を印刷', () => QI.openPrintPreview('quote', record)));

    if (record.invoice_no.value) {
      // 作成済みなら、請求書へのリンクを出す
      const link = QI.el('a', 'qi-link', `請求書 ${record.invoice_no.value} を開く →`);
      link.href = QI.recordUrl(QI.APP_ID.INVOICE, record.invoice_record_id.value);
      bar.appendChild(link);
    } else if (record.status.value === STATUS.WON) {
      const button = QI.createButton('請求書を作成', () => createInvoice(button), 'qi-btn--primary');
      bar.appendChild(button);
    } else {
      bar.appendChild(QI.el('span', 'qi-hint', 'ステータスを「受注」にすると、請求書を作成できます'));
    }
    return event;
  });
})();
