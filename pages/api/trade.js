import axios from 'axios';
import { Client } from '@notionhq/client';

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DB_ID = process.env.NOTION_DB_ID;
const TELEGRAM_CHAT_ID = -1002304096819;
const notion = new Client({ auth: NOTION_API_KEY });

// 메시지 생성 함수
const createMessage = (data) => {
  if (data.action === 'open') {
    return `
📈 *Оролт хийлээ* 📈
┌────────────────
│ ▪ Хослол: ${data.symbol} (${data.direction})
│ ▪ Үнэ: ${data.price.toFixed(5)}
│ ▪ Лот: ${data.volume.toFixed(2)}
│ ▪ Данс: $${data.balance.toFixed(2)}
└────────────────`;
  }

  if (data.action === 'update') {
    let title = '';
    const lines = [];
    
    if (data.sl && data.tp) {
      title = '🔄 SL&TP тохируулсан 🔄';
      lines.push(`│ ▪️ SL: ${data.sl.toFixed(5)}`);
      lines.push(`│ ▪️ TP: ${data.tp.toFixed(5)}`);
    } else if (data.sl) {
      title = '🔄 SL тохируулсан 🔄';
      lines.push(`│ ▪️ SL: ${data.sl.toFixed(5)}`);
    } else if (data.tp) {
      title = '🔄 TP тохируулсан 🔄';
      lines.push(`│ ▪️ TP: ${data.tp.toFixed(5)}`);
    }

    return `${title}\n┌────────────────\n${lines.join('\n')}\n└────────────────`;
  }

  if (data.action === 'close') {
    return `
📉 *Оролт хаалаа* 📉
┌────────────────
│ ▪ Ашиг: $${data.profit.toFixed(2)}
│ ▪ Данс: $${data.balance.toFixed(2)}
└────────────────`;
  }
};

// Notion 페이지 정보 조회
const getNotionPageInfo = async (orderId) => {
  const response = await notion.databases.query({
    database_id: NOTION_DB_ID,
    filter: { property: 'Order ID', number: { equals: orderId } }
  });

  if (response.results.length > 0) {
    const page = response.results[0];
    return {
      pageId: page.id,
      messageId: page.properties['Message ID'].number
    };
  }
  return null;
};

// Notion 새 페이지 생성
const createNotionPage = async (data) => {
  await notion.pages.create({
    parent: { database_id: NOTION_DB_ID },
    properties: {
      'Order ID': { number: data.position },
      'Action': { select: { name: data.action }},
      'Type': { select: { name: data.direction }},
      'Symbol': { title: [{ text: { content: data.symbol }}] },
      'Volume': { number: data.volume },
      'Price': { number: data.price },
      'SL': { number: data.sl || 0 },
      'TP': { number: data.tp || 0 },
      'Balance': { number: data.balance },
      'Message ID': { number: data.messageId }
    }
  });
};

// Notion 페이지 업데이트
const updateNotionPage = async (pageId, updates) => {
  const properties = {};
  
  if ('sl' in updates) properties['SL'] = { number: updates.sl || 0 };
  if ('tp' in updates) properties['TP'] = { number: updates.tp || 0 };
  if ('profit' in updates) properties['Profit'] = { number: updates.profit };
  if ('balance' in updates) properties['Balance'] = { number: updates.balance };
  if ('outprice' in updates) properties['Outprice'] = { number: updates.outprice };

  await notion.pages.update({
    page_id: pageId,
    properties
  });
};

// 닫기 액션 처리
const handleCloseAction = async (data) => {
  const pageInfo = await getNotionPageInfo(data.position);
  if (!pageInfo) return;

  const message = createMessage({
    action: 'close',
    profit: data.profit,
    balance: data.balance
  });

  await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: 'Markdown',
    reply_to_message_id: pageInfo.messageId
  });

  await updateNotionPage(pageInfo.pageId, {
    profit: data.profit,
    balance: data.balance,
    outprice: data.price
  });
};

// 메인 핸들러
export default async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    const { action, ...data } = req.body;

    // 액션 유효성 검사
    if (!['open', 'update', 'close'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action type' });
    }

    // OPEN 액션 처리
    if (action === 'open') {
      const tgResponse = await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
        {
          chat_id: TELEGRAM_CHAT_ID,
          text: createMessage(data),
          parse_mode: 'Markdown'
        }
      );

      await createNotionPage({
        ...data,
        messageId: tgResponse.data.result.message_id
      });

      return res.status(200).json({ status: 'success' });
    }

    // UPDATE 액션 처리
    if (action === 'update') {
      const pageInfo = await getNotionPageInfo(data.position);
      if (!pageInfo) {
        return res.status(404).json({ error: 'Order not found' });
      }

      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
        {
          chat_id: TELEGRAM_CHAT_ID,
          text: createMessage({ action, ...data }),
          parse_mode: 'Markdown',
          reply_to_message_id: pageInfo.messageId
        }
      );

      await updateNotionPage(pageInfo.pageId, {
        sl: data.sl,
        tp: data.tp
      });

      return res.status(200).json({ status: 'success' });
    }

    // CLOSE 액션 처리
    if (action === 'close') {
      await handleCloseAction(data);
      return res.status(200).json({ status: 'success' });
    }

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};