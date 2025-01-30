const createMessage = (data) => {
  const slFormatted = data.sl ? `SL: ${(data.sl ?? 0).toFixed(5)}` : '';
  const tpFormatted = data.tp ? `TP: ${(data.tp ?? 0).toFixed(5)}` : '';

  let updateMessageType = '';
  if (slFormatted && tpFormatted) {
    updateMessageType = 'SL&TP тохируулсан';
  } else if (slFormatted) {
    updateMessageType = 'SL тохируулсан';
  } else if (tpFormatted) {
    updateMessageType = 'TP тохируулсан';
  }

  const templates = {
    open: `
📈 *Оролт хийлээ* 📈
┌────────────────
│ ▪ Хослол: ${data.symbol || 'N/A'} (${data.direction || 'N/A'})
│ ▪ Үнэ: ${(data.price ?? 0).toFixed(5)}
│ ▪ Лот: ${(data.volume ?? 0).toFixed(2)}
│ ▪ Данс: $${(data.balance ?? 0).toFixed(2)}
└────────────────`,

    update: `
🔄 *${updateMessageType}* 🔄
┌────────────────
│ ▪ ${slFormatted}
│ ▪ ${tpFormatted}
└────────────────`,

    close: `
📉 *Оролт хаалаа* 📉
┌────────────────
│ ▪ Ашиг: $${(data.profit ?? 0).toFixed(2)}
│ ▪ Хаалтын үнэ: ${(data.outprice ?? 0).toFixed(5)}
│ ▪ Данс: $${(data.balance ?? 0).toFixed(2)}
└────────────────`,
  };

  return templates[data.action];
};

const updateNotion = async (data) => {
  const response = await notion.databases.query({
    database_id: NOTION_DB_ID,
    filter: {
      property: 'Order ID',
      number: {
        equals: data.position || 0,
      },
    },
  });

  if (response.results.length > 0) {
    const pageId = response.results[0].id;

    const properties = {
      ...(data.sl !== undefined && { SL: { number: data.sl } }),
      ...(data.tp !== undefined && { TP: { number: data.tp } }),
      ...(data.profit !== undefined && { Profit: { number: data.profit } }),
      ...(data.balance !== undefined && { Balance: { number: data.balance } }),
      ...(data.outprice !== undefined && { Outprice: { number: data.outprice } }),
    };

    console.log(`Updating Notion Page ID: ${pageId}`);
    await notion.pages.update({
      page_id: pageId,
      properties,
    });
  } else {
    console.log(`No existing row for Order ID ${data.position}, creating a new row.`);

    await notion.pages.create({
      parent: { database_id: NOTION_DB_ID },
      properties: {
        'Order ID': { number: data.position || 0 },
        'Action': { select: { name: data.action }},
        ...(data.direction && { 'Type': { select: { name: data.direction }}}),
        'Symbol': { title: [{ text: { content: data.symbol || '' }}] },
        'Volume': { number: data.volume || 0 },
        'Price': { number: data.price || 0 },
        'SL': { number: data.sl || 0 },
        'TP': { number: data.tp || 0 },
        'Profit': { number: data.profit || 0 },
        'Balance': { number: data.balance },
        ...(data.outprice && { Outprice: { number: data.outprice }}),
        'Message ID': { number: data.messageId || 0 },
      },
    });
  }
};

const handleCloseAction = async (data) => {
  try {
    const replyMessageId = await getMessageIdFromNotion(data.position);

    if (!replyMessageId) {
      console.log(`No previous message found for Order: #${data.position}`);
      return;
    }

    const message = createMessage({
      action: 'close',
      position: data.position,
      profit: data.profit,
      balance: data.balance,
      outprice: data.price, // 추가된 필드
    });

    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
        reply_to_message_id: replyMessageId || undefined,
      }
    );

    await updateNotion({
      ...data,
      action: 'close',
      messageId: replyMessageId,
      outprice: data.price, // 노션 업데이트에 추가된 가격
    });
  } catch (error) {
    console.error('Error handling close action:', error);
  }
};
