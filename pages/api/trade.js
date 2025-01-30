import axios from 'axios';
import { Client } from '@notionhq/client';

// 환경 변수
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DB_ID = process.env.NOTION_DB_ID;
const TELEGRAM_CHAT_ID = -1002304096819;
const notion = new Client({ auth: NOTION_API_KEY });

// 텔레그램 메시지 생성
const createMessage = (data) => {
  const templates = {
    open: `
📈 *New Position Opened* 📈
┌────────────────
│ ▪ Order: #${data.position || 'N/A'}
│ ▪ Symbol: ${data.symbol || 'N/A'}
│ ▪ Volume: ${(data.volume ?? 0).toFixed(2)} lots
│ ▪ Price: ${(data.price ?? 0).toFixed(5)}
│ ▪ SL: ${(data.sl ?? 0).toFixed(5) || 'None'}
│ ▪ TP: ${(data.tp ?? 0).toFixed(5) || 'None'}
│ ▪ Balance: $${(data.balance ?? 0).toFixed(2)}
└────────────────`,

    update: `
🔄 *Position Updated* 🔄
┌────────────────
│ ▪ Order: #${data.position || 'N/A'}
│ ▪ New SL: ${(data.sl ?? 0).toFixed(5) || 'None'}
│ ▪ New TP: ${(data.tp ?? 0).toFixed(5) || 'None'}
│ ▪ Balance: $${(data.balance ?? 0).toFixed(2)}
└────────────────`,

    close: `
📉 *Position Closed* 📉
┌────────────────
│ ▪ Order: #${data.position || 'N/A'}
│ ▪ Profit: $${(data.profit ?? 0).toFixed(2)}
│ ▪ Balance: $${(data.balance ?? 0).toFixed(2)}
└────────────────`
  };

  return templates[data.action];
};

// Notion 데이터베이스 업데이트
const updateNotion = async (data) => {
  const properties = {
    'Order ID': { number: data.position || 0 },
    'Action': { select: { name: data.action }},
    'Symbol': { title: [{ text: { content: data.symbol || '' }}] },  // Symbol as a title property
    'Volume': { number: data.volume || 0 },
    'Price': { number: data.price || 0 },
    'SL': { number: data.sl || 0 },
    'TP': { number: data.tp || 0 },
    'Profit': { number: data.profit || 0 },
    'Balance': { number: data.balance },
    'Message ID': { number: data.messageId || 0 }  // Store the Telegram message ID
  };

  await notion.pages.create({
    parent: { database_id: NOTION_DB_ID },
    properties
  });
};

// Fetch the Message ID from Notion based on Order ID
const getMessageIdFromNotion = async (orderId) => {
  const response = await notion.databases.query({
    database_id: NOTION_DB_ID,
    filter: {
      property: 'Order ID',
      number: {
        equal: orderId
      }
    }
  });

  if (response.results.length > 0) {
    // Extract the message ID from Notion data
    return response.results[0].properties['Message ID'].number;
  }
  
  return null;  // No message found for this order ID
};

// Modify the API handler to capture the actual Telegram message ID
export default async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    const { action, chat_id, reply_to, ...data } = req.body;

    // Ensure valid action
    if (!['open', 'update', 'close'].includes(action)) {
      throw new Error('Invalid action type');
    }

    // Handle message creation based on action type
    const message = createMessage({ action, ...data });

    // Determine if reply_to_message_id is needed for 'update' and 'close'
    let replyToMessageId;
    
    if (action === 'open') {
      // Send message to Telegram and capture the response to get the message_id
      const tgResponse = await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
        {
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: 'Markdown',
          reply_to_message_id: undefined
        },
        { timeout: 5000 }  // Timeout added for reliability
      );

      // Capture the message_id from the Telegram response
      const telegramMessageId = tgResponse.data.result.message_id;

      // Update Notion with the message_id from Telegram
      await updateNotion({
        ...data,
        action,
        messageId: telegramMessageId  // Save the actual message_id from Telegram
      });

      res.status(200).json({
        status: 'success',
        message_id: telegramMessageId  // Return the correct message_id
      });

    } else if (action === 'close') {
      // Fetch the message_id from Notion for the given order ID
      const messageId = await getMessageIdFromNotion(data.position);

      if (messageId === null) {
        return res.status(404).json({ error: 'Order not found in Notion' });
      }

      // Send message to Telegram and reply to the correct message using the message_id
      const tgResponse = await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
        {
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: 'Markdown',
          reply_to_message_id: messageId  // Reply to the original message using the correct message_id
        },
        { timeout: 5000 }
      );

      res.status(200).json({
        status: 'success',
        message_id: tgResponse.data.result.message_id  // Return the new message ID for the close action
      });
    }

  } catch (error) {
    // Enhanced error logging
    console.error('Full error stack:', error.stack);
    console.error('Request body:', req.body);

    res.status(500).json({
      error: 'Internal Server Error',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};
