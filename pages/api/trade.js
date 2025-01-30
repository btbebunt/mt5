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

    update: (data) => {
      const sl = data.sl ? `SL: ${(data.sl).toFixed(5)}` : '';
      const tp = data.tp ? `TP: ${(data.tp).toFixed(5)}` : '';
      const message = [
        "🔄 *Position Updated* 🔄",
        "┌────────────────",
        `│ ▪ Order: #${data.position || 'N/A'}`,
        sl ? `│ ▪ ${sl}` : '',
        tp ? `│ ▪ ${tp}` : '',
        `│ ▪ Balance: $${(data.balance ?? 0).toFixed(2)}`,
        "└────────────────"
      ].filter(Boolean).join("\n");

      return message;
    },

    close: (data) => {
      return `
📉 *Оролт хаалаа* 📉
┌────────────────
│ ▪ Ашиг: $${(data.profit ?? 0).toFixed(2)}
│ ▪ Данс: $${(data.balance ?? 0).toFixed(2)}
└────────────────`;
    }
  };

  // Instead of calling templates[data.action] as a function, ensure it's treated as a template string
  const template = templates[data.action];

  if (typeof template === 'function') {
    return template(data); // If it's a function, execute it with `data`
  } else if (typeof template === 'string') {
    return template; // If it's a string, return it directly
  } else {
    throw new Error(`Invalid action type: ${data.action}`); // Handle invalid action types
  }
};


const updateNotion = async (data) => {
  const properties = {
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
    'Message ID': { number: data.messageId || 0 },
    ...(data.outprice && { 'OutPrice': { number: data.outprice }})
  };

  console.log(`Updating Notion for Order ID: ${data.position}, messageId: ${data.messageId}`);

  await notion.pages.update({
    page_id: data.notionPageId,
    properties
  });
};

// Function to get the Notion page ID from the Order ID
const getNotionPageId = async (orderId) => {
  const response = await notion.databases.query({
    database_id: NOTION_DB_ID,
    filter: {
      property: 'Order ID',
      number: { equals: orderId }
    }
  });

  if (response.results.length > 0) {
    return response.results[0].id; // Return the page ID
  }

  console.log(`No page found for Order ID ${orderId}`);
  return null;
};

const handleCloseAction = async (data) => {
  try {
    const notionPageId = await getNotionPageId(data.position);
    
    if (!notionPageId) {
      console.log(`No previous message found for Order: #${data.position}`);
      return;
    }

    const message = createMessage({
      action: 'close',
      position: data.position,
      profit: data.profit,
      balance: data.balance,
    });

    const tgResponse = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
        reply_to_message_id: data.replyToMessageId || undefined,
      }
    );

    await updateNotion({
      ...data,
      action: 'close',
      messageId: tgResponse.data.result.message_id,
      notionPageId,
      outprice: data.price // Store close price as `outprice`
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

    if (action === 'open' || action === 'update') {
      const replyToMessageId = action === 'open' ? undefined : reply_to;

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
      const notionPageId = await getNotionPageId(data.position);

      if (!notionPageId) {
        // If no page exists, create a new row in Notion
        await updateNotion({
          ...data,
          action,
          messageId: telegramMessageId
        });
      } else {
        // Update the existing row
        await updateNotion({
          ...data,
          action,
          messageId: telegramMessageId,
          notionPageId
        });
      }

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
