import axios from 'axios';
import { Client } from '@notionhq/client';

// 환경 변수
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DB_ID = process.env.NOTION_DB_ID;

const notion = new Client({ auth: NOTION_API_KEY });

// 텔레그램 메시지 생성
const createMessage = (data) => {
  const templates = {
    open: `
📈 *New Position Opened* 📈
┌────────────────
│ ▪ Order: #${data.order}
│ ▪ Symbol: ${data.symbol}
│ ▪ Volume: ${data.volume.toFixed(2)} lots
│ ▪ Price: ${data.price.toFixed(5)}
│ ▪ SL: ${data.sl?.toFixed(5) || 'None'}
│ ▪ TP: ${data.tp?.toFixed(5) || 'None'}
│ ▪ Balance: $${data.balance.toFixed(2)}
└────────────────`,

    update: `
🔄 *Position Updated* 🔄
┌────────────────
│ ▪ Order: #${data.order}
│ ▪ New SL: ${data.sl?.toFixed(5) || 'None'}
│ ▪ New TP: ${data.tp?.toFixed(5) || 'None'}
│ ▪ Balance: $${data.balance.toFixed(2)}
└────────────────`,

    close: `
📉 *Position Closed* 📉
┌────────────────
│ ▪ Order: #${data.order}
│ ▪ Profit: $${data.profit.toFixed(2)}
│ ▪ Balance: $${data.balance.toFixed(2)}
└────────────────`
  };
  
  return templates[data.action];
};

// Notion 데이터베이스 업데이트
const updateNotion = async (data) => {
  const properties = {
    'Order ID': { number: data.order },
    'Action': { select: { name: data.action }},
    'Symbol': { rich_text: [{ text: { content: data.symbol || '' }}] },
    'Volume': { number: data.volume || 0 },
    'Price': { number: data.price || 0 },
    'SL': { number: data.sl || 0 },
    'TP': { number: data.tp || 0 },
    'Profit': { number: data.profit || 0 },
    'Balance': { number: data.balance },
    'Message ID': { number: data.messageId }
  };

  await notion.pages.create({
    parent: { database_id: NOTION_DB_ID },
    properties
  });
};

// API 핸들러
export default async (req, res) => {
  try {
    // CORS 설정
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    
    if(req.method === 'OPTIONS') return res.status(200).end();

    const { action, chat_id, reply_to, ...data } = req.body;
    
    // 1. 텔레그램 메시지 전송
    const message = createMessage({ action, ...data });
    const tgResponse = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        chat_id,
        text: message,
        parse_mode: 'Markdown',
        reply_to_message_id: action !== 'open' ? reply_to : undefined
      }
    );

    // 2. Notion 업데이트
    await updateNotion({
      ...data,
      action,
      messageId: tgResponse.data.result.message_id
    });

    // 3. 메시지 ID 반환
    res.status(200).json({
      message_id: tgResponse.data.result.message_id
    });

  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};