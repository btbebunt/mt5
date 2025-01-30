import axios from 'axios';
import { Client } from '@notionhq/client';

// 환경 변수
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DB_ID = process.env.NOTION_DB_ID;
const TELEGRAM_CHAT_ID = -1002304096819;
const notion = new Client({ auth: NOTION_API_KEY });

const createMessage = (data) => {
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
🔄 *Position Updated* 🔄
┌────────────────
│ ▪ Order: #${data.position || 'N/A'}
│ ▪ SL: ${(data.sl ?? 0).toFixed(5) || 'None'}
│ ▪ TP: ${(data.tp ?? 0).toFixed(5) || 'None'}
│ ▪ Balance: $${(data.balance ?? 0).toFixed(2)}
└────────────────`,

    close: `
📉 *Оролт хаалаа* 📉
┌────────────────
│ ▪ Ашиг: $${(data.profit ?? 0).toFixed(2)}
│ ▪ Данс: $${(data.balance ?? 0).toFixed(2)}
└────────────────`
  };

  return templates[data.action];
};

// Notion 데이터베이스 업데이트
const updateNotion = async (data) => {
  const properties = {
    'Order ID': { number: data.position || 0 },
    ...(data.action && {'Action': { select: { name: data.action }}}),
    ...(data.direction && { 'Type': { select: { name: data.direction }}}),
     ...(data.symbol && {'Symbol': { title: [{ text: { content: data.symbol || '' }}]} }),
    'Volume': { number: data.volume || 0 },
    'Price': { number: data.price || 0 },
    'SL': { number: data.sl || 0 },
    'TP': { number: data.tp || 0 },
    'Profit': { number: data.profit || 0 },
    'Balance': { number: data.balance },
    ...(data.messageId && { 'Message ID': { number: data.messageId }}) // Don't update messageId
  };

  console.log(`Updating Notion for Order ID: ${data.position}`);

  // Find the page and update it
  const response = await notion.databases.query({
    database_id: NOTION_DB_ID,
    filter: {
      property: 'Order ID',
      number: {
        equals: data.position
      }
    }
  });

  if (response.results.length > 0) {
    await notion.pages.update({
      page_id: response.results[0].id,
      properties
    });
  } else {
    console.error(`Order ID ${data.position} not found in Notion.`);
  }
};

// Create a new page in Notion for the initial order open action
const createNotionPage = async (data) => {
  const properties = {
    'Order ID': { number: data.position || 0 },
    'Action': { select: { name: 'open' }},
    'Symbol': { title: [{ text: { content: data.symbol || '' }}] },
    'Volume': { number: data.volume || 0 },
    'Price': { number: data.price || 0 },
    'SL': { number: data.sl || 0 },
    'TP': { number: data.tp || 0 },
    'Profit': { number: 0 }, // Initially profit is 0
    'Balance': { number: data.balance || 0 },
    ...(data.direction && { 'Type': { select: { name: data.direction }}}), // Save direction as type
  };

  console.log(`Creating Notion page for Order ID: ${data.position}`);

  const response = await notion.pages.create({
    parent: { database_id: NOTION_DB_ID },
    properties
  });

  return response;
};

// Function to get Message ID from Notion based on Order ID
const getMessageIdFromNotion = async (orderId) => {
  const response = await notion.databases.query({
    database_id: NOTION_DB_ID,
    filter: {
      property: 'Order ID',
      number: {
        equals: orderId
      }
    }
  });

  if (response.results.length > 0) {
    return response.results[0].properties['Message ID'].number;
  }

  return null;
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
    });

  } catch (error) {
    console.error('Error handling close action:', error);
  }
};

export default async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    const { action, chat_id, reply_to, ...data } = req.body;

    if (!['open', 'update', 'close'].includes(action)) {
      throw new Error('Invalid action type');
    }

    console.log(`Received action: ${action}, data: `, data);

    const message = createMessage({ action, ...data });

    if (action === 'open') {
      // Create a new page for the open action
      const tgResponse = await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
        {
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: 'Markdown',
        },
        { timeout: 5000 }
      );

      const telegramMessageId = tgResponse.data.result.message_id;

      // Create Notion page for the new order
      const notionPage = await createNotionPage({
        ...data,
        messageId: telegramMessageId
      });

      // Update Notion with the Message ID
      await updateNotion({
        ...data,
        action: 'open',
        messageId: telegramMessageId
      });

      res.status(200).json({
        status: 'success',
        message_id: telegramMessageId,
        notion_page_id: notionPage.id
      });
    }

    if (action === 'update' || action === 'close') {

      const notionRow = await nti
      // Handle update and close actions
      const replyToMessageId = action === 'update' ? reply_to : undefined;

      const tgResponse = await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
        {
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: 'Markdown',
          reply_to_message_id: replyToMessageId,
        },
        { timeout: 5000 }
      );

      const telegramMessageId = tgResponse.data.result.message_id;

      await updateNotion({
        ...data,
        action,
        messageId: data.messageId || telegramMessageId
      });

      res.status(200).json({
        status: 'success',
        message_id: telegramMessageId
      });
    }

    if (action === 'close') {
      console.log(`Close action triggered for Order: #${data.position}`);

      await handleCloseAction(data);
      res.status(200).json({ status: 'success' });
    }

  } catch (error) {
    console.error('Full error stack:', error.stack);
    console.error('Request body:', req.body);

    res.status(500).json({
      error: 'Internal Server Error',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};
