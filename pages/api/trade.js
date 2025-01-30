import axios from 'axios';
import { Client } from '@notionhq/client';

// 환경 변수
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DB_ID = process.env.NOTION_DB_ID;
const TELEGRAM_CHAT_ID = -1002304096819;
const notion = new Client({ auth: NOTION_API_KEY });

// Create message based on action
const createMessage = (data) => {
  let message = '';
  
  switch (data.action) {
    case 'update':
      // Handle SL, TP, or both updates
      if (data.sl && data.tp) {
        message = `
🔄 SL&TP тохируулсан 🔄
┌────────────────
│ ▪️ SL: ${data.sl}
│ ▪️ TP: ${data.tp}
└────────────────`;
      } else if (data.sl) {
        message = `
🔄 SL тохируулсан 🔄
┌────────────────
│ ▪️ SL: ${data.sl}
└────────────────`;
      } else if (data.tp) {
        message = `
🔄 TP тохируулсан 🔄
┌────────────────
│ ▪️ TP: ${data.tp}
└────────────────`;
      }
      break;

    case 'close':
      message = `
📉 *Оролт хаалаа* 📉
┌────────────────
│ ▪ Ашиг: $${(data.profit ?? 0).toFixed(2)}
│ ▪ Данс: $${(data.balance ?? 0).toFixed(2)}
└────────────────`;
      break;
      
    case 'open':
    default:
      message = `
📈 *Оролт хийлээ* 📈
┌────────────────
│ ▪ Хослол: ${data.symbol || 'N/A'} (${data.direction || 'N/A'})
│ ▪ Үнэ: ${(data.price ?? 0).toFixed(5)}
│ ▪ Лот: ${(data.volume ?? 0).toFixed(2)}
│ ▪ Данс: $${(data.balance ?? 0).toFixed(2)}
└────────────────`;
      break;
  }
  return message;
};

// Update Notion database record
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
    'OutPrice': { number: data.outprice || 0 } // Closing price
  };

  console.log(`Updating Notion for Order ID: ${data.position}, messageId: ${data.messageId}`);

  await notion.pages.update({
    page_id: data.pageId, // Update the existing page instead of creating a new one
    properties
  });
};

// Get Message ID from Notion for the given Order ID
const getMessageIdFromNotion = async (orderId) => {
  const response = await notion.databases.query({
    database_id: NOTION_DB_ID,
    filter: {
      property: 'Order ID',
      number: { equals: orderId }
    }
  });

  if (response.results.length > 0) {
    return response.results[0].properties['Message ID'].number;
  }

  return null;
};

const handleAction = async (data) => {
  try {
    const replyMessageId = await getMessageIdFromNotion(data.position);
    
    if (!replyMessageId) {
      console.log(`No previous message found for Order: #${data.position}`);
      return;
    }

    // Create the message based on action (open, update, close)
    const message = createMessage(data);

    // Send the message to Telegram with the reply-to functionality
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
        reply_to_message_id: replyMessageId || undefined,
      }
    );

    // Update Notion with the new details
    await updateNotion({
      ...data,
      messageId: replyMessageId,
      pageId: data.pageId // Update the existing page with the pageId
    });

  } catch (error) {
    console.error('Error handling action:', error);
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

    if (action === 'close' || action === 'update') {
      console.log(`Action triggered for Order: #${data.position}`);
      await handleAction(data);
      res.status(200).json({ status: 'success' });
    }

  } catch (error) {
    console.error('Full error stack:', error.stack);
    res.status(500).json({
      error: 'Internal Server Error',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};
