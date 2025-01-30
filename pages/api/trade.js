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
  // 기존 데이터를 가져오기
  const currentData = await getCurrentNotionData(data.position);

  const properties = {
    'Order ID': { number: data.position || currentData.position },
    'Action': { select: { name: data.action || currentData.action }},
    'Symbol': { title: [{ text: { content: data.symbol || currentData.symbol }}] },
    'Volume': { number: data.volume || currentData.volume },
    'Price': { number: data.price || currentData.price },
    'SL': { number: data.sl || currentData.sl },
    'TP': { number: data.tp || currentData.tp },
    'Profit': { number: data.profit || currentData.profit },
    'Balance': { number: data.balance || currentData.balance },
    'Message ID': { number: data.messageId || currentData.messageId },
    ...(data.outPrice !== undefined && { 'Outprice': { number: data.outPrice || currentData.outPrice }}) // Closing price handling
  };

  console.log(`Saving to Notion for Order ID: ${data.position}, messageId: ${data.messageId}`);

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
    const pageId = response.results[0].id;
    console.log(`Found existing page with Order ID: ${data.position}, updating...`);

    await notion.pages.update({
      page_id: pageId,
      properties,
    });

    console.log(`Page updated successfully for Order ID: ${data.position}`);
  } else {
    console.log(`No existing page found for Order ID: ${data.position}, creating new one.`);

    await notion.pages.create({
      parent: { database_id: NOTION_DB_ID },
      properties,
    });
  }
};

// 기존 Notion 데이터 가져오기
const getCurrentNotionData = async (orderId) => {
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
    const page = response.results[0];
    return {
      position: page.properties['Order ID'].number || 0,
      action: page.properties['Action'].select?.name || '',
      symbol: page.properties['Symbol'].title[0]?.text.content || '',
      volume: page.properties['Volume'].number || 0,
      price: page.properties['Price'].number || 0,
      sl: page.properties['SL'].number || 0,
      tp: page.properties['TP'].number || 0,
      profit: page.properties['Profit'].number || 0,
      balance: page.properties['Balance'].number || 0,
      messageId: page.properties['Message ID'].number || 0,
      outPrice: page.properties['Outprice']?.number || 0
    };
  }

  return {}; // 빈 객체 반환 (없을 경우)
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

  console.log(`Notion query response for Order ID ${orderId}:`, response);

  if (response.results.length > 0) {
    const messageId = response.results[0].properties['Message ID'].number;
    console.log(`Found message ID for Order ID ${orderId}:`, messageId);
    return messageId;
  }

  console.log(`No message found for Order ID ${orderId}`);
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

      await updateNotion({
        ...data,
        action,
        messageId: telegramMessageId
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
