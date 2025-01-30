import axios from 'axios';
import { Client } from '@notionhq/client';

// 환경 변수
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DB_ID = process.env.NOTION_DB_ID;
const TELEGRAM_CHAT_ID =-1002304096819;
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
    'Volume': { number: data.volume || 0 },  // Ensure 'Volume' is a number property in your database
    'Price': { number: data.price || 0 },  // Ensure 'Price' is a number property in your database
    'SL': { number: data.sl || 0 },
    'TP': { number: data.tp || 0 },
    'Profit': { number: data.profit || 0 },
    'Balance': { number: data.balance },
    'Message ID': { number: data.messageId || 0 }  // Ensure 'Message ID' is a number property
  };

  await notion.pages.create({
    parent: { database_id: NOTION_DB_ID },
    properties
  });
};


// Modify the API handler (send the 'update' action properly)
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
    const replyToMessageId = action === 'open' ? undefined : reply_to;

    // Send message to Telegram
    const tgResponse = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
        reply_to_message_id: replyToMessageId
      },
      { timeout: 5000 }  // Timeout added for reliability
    );

    // Update Notion
    await updateNotion({
      ...data,
      action,
      messageId: tgResponse.data.result.message_id  // Save the message ID
    });

    res.status(200).json({
      status: 'success',
      message_id: tgResponse.data.result.message_id 
    });
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
