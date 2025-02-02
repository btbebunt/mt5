import axios from 'axios';
import { Client } from '@notionhq/client';

// 환경 변수
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DB_ID = process.env.NOTION_DB_ID;
const TELEGRAM_CHAT_ID = -1002304096819;
const notion = new Client({ auth: NOTION_API_KEY });

const calculatePips = (symbol, openPrice, closePrice) => {
  if (!symbol) {
    console.error('Symbol is missing or undefined');
    return 0;  // Return a default value (e.g., 0) if symbol is invalid
  }

  let pipValue = 0;

  // Check if the symbol is a major Forex pair (typically 4 decimal places)
  if (symbol.includes("JPY")) {
    // If it's a JPY pair, calculate with 2 decimal places
    pipValue = (closePrice - openPrice) * 100;
  } else {
    // For most other pairs, calculate with 4 decimal places
    pipValue = (closePrice - openPrice) * 10000;
  }

  return pipValue;
};


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
│ ▪ Profit: ${data.profit} pips
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
    'Symbol': { title: [{ text: { content: data.symbol || '' }}] },
    'Volume': { number: data.volume || 0 },
    'Price': { number: data.price || 0 },
    'SL': { number: data.sl || 0 },
    'TP': { number: data.tp || 0 },
    'Profit': { number: data.profit || 0 },  // Profit in pips
    'Balance': { number: data.balance },
    'Message ID': { number: data.messageId || 0 }
  };

  await notion.pages.create({
    parent: { database_id: NOTION_DB_ID },
    properties
  });
};

// Function to get Message ID from Notion based on Order ID (position)
const getMessageIdFromNotion = async (orderId) => {
  console.log('Fetching message ID for Order:', orderId);  // Log to verify
  const response = await notion.databases.query({
    database_id: NOTION_DB_ID,
    filter: {
      property: 'Order ID',
      number: {
        equals: orderId  // Ensure the filter structure is correct
      }
    }
  });

  if (response.results.length > 0) {
    const messageId = response.results[0].properties['Message ID'].number;
    console.log('Found Message ID:', messageId);  // Log to verify
    return messageId;
  }

  console.log('No Message ID found for Order:', orderId);  // Log to verify
  return null;
};

// Function to handle 'close' action and update Notion
const handleCloseAction = async (data) => {
  try {
    console.log('Handling close action for Order:', data.position);  // Log to verify

    // Calculate profit in pips based on symbol and price
    const profitInPips = calculatePips(data.symbol, data.openPrice, data.closePrice);
    console.log('Calculated profit in pips:', profitInPips);  // Log to verify

    const replyMessageId = await getMessageIdFromNotion(data.position);
    
    const message = createMessage({
      action: 'close',
      position: data.position,
      profit: profitInPips,  // Use calculated profit in pips
      balance: data.balance,
    });

    // Send the close message to Telegram, replying to the original message if it exists
    const tgResponse = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
        reply_to_message_id: replyMessageId || undefined,  // Only reply if message ID exists
      }
    );

    console.log('Telegram Response:', tgResponse.data);  // Log to verify Telegram response

    // Update Notion with the close action details
    await updateNotion({
      ...data,
      action: 'close',
      profit: profitInPips,  // Store profit in pips in Notion
      messageId: replyMessageId,  // Include message ID from Telegram response
    });
  } catch (error) {
    console.error('Error handling close action:', error);
  }
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

    // Handle 'open' or 'update' actions
    if (action === 'open' || action === 'update') {
      const replyToMessageId = action === 'open' ? undefined : reply_to;

      // Send the message to Telegram
      const tgResponse = await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
        {
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: 'Markdown',
          reply_to_message_id: replyToMessageId,
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
    }

    // Handle 'close' action specifically
    if (action === 'close') {
      await handleCloseAction(data);
      res.status(200).json({ status: 'success' });
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
