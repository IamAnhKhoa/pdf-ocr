export interface Env {
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  DB?: any;
}

const GEMINI_KEYS = [
  "REDACTED_GEMINI_KEY",
  "REDACTED_GEMINI_KEY",
  "REDACTED_GEMINI_KEY",
  "REDACTED_GEMINI_KEY",
  "REDACTED_GEMINI_KEY"
];

const HARDCODED_OPENROUTER_KEY = "";
const HARDCODED_GROQ_KEY = "";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
};

const promptText = `Bạn là một trợ lý ảo chuyên trích xuất thông tin từ văn bản scan. 
Dưới đây là hình ảnh các trang (trang đầu và có thể trang cuối) của một văn bản hành chính.
Vui lòng trích xuất các thông tin sau và trả về DUY NHẤT một JSON hợp lệ (không chứa markdown, không chứa text thừa, chỉ JSON):
{
  "soDen": "SỐ ĐẾN (nếu có, thường nằm ở góc hoặc dấu đến)",
  "soKyHieu": "SỐ KÝ HIỆU (Ví dụ: 4524/QĐ-UBND)",
  "noiDung": "NỘI DUNG / TRÍCH YẾU (Ví dụ: V/v Thành lập Trạm Y tế...)",
  "ngayVBDen": "NGÀY VB ĐẾN (Ngày tháng năm trên văn bản hoặc dấu đến, định dạng DD/MM/YYYY)",
  "thoiHanGiaiQuyet": "THỜI HẠN GIẢI QUYẾT (nếu có ghi trong nội dung)",
  "yKienChiDao": "Ý KIẾN CHỈ ĐẠO (nếu có)",
  "tienDoGiaiQuyet": "TIẾN ĐỘ GIẢI QUYẾT VĂN BẢN (nếu có)",
  "soKyHieuVBTraLoi": "SỐ KÝ HIỆU VB TRẢ LỜI (nếu có)"
}
Nếu không tìm thấy thông tin nào, hãy để chuỗi rỗng "".`;

async function tryGeminiWithKeyRotation(images: string[], model: string, keysToTry: string[]): Promise<string> {
  let lastError: any = null;
  const targetModel = model || 'gemini-2.5-flash';

  for (let i = 0; i < keysToTry.length; i++) {
    const currentKey = keysToTry[i];
    try {
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${currentKey}`;
      const parts: any[] = [{ text: promptText }];
      
      for (const imgBase64 of images) {
        parts.push({
          inline_data: {
            mime_type: 'image/jpeg',
            data: imgBase64
          }
        });
      }

      const geminiResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.1 }
        })
      });

      if (!geminiResponse.ok) {
        const errorText = await geminiResponse.text();
        throw new Error(`Gemini API Key ${i + 1} failed: ${geminiResponse.status} ${errorText}`);
      }

      const geminiData = await geminiResponse.json() as any;
      const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!text) {
        throw new Error(`Empty response from Gemini Key ${i + 1}`);
      }

      return text;
    } catch (err: any) {
      console.error(`Gemini rotation step ${i + 1} error:`, err.message);
      lastError = err;
    }
  }

  throw lastError || new Error("Tất cả key API Gemini đều thất bại.");
}

async function callOpenRouter(images: string[], model: string, customKey?: string): Promise<string> {
  const openRouterKey = customKey || HARDCODED_OPENROUTER_KEY;
  const targetModel = model || 'google/gemini-2.5-flash:free';
  const apiUrl = 'https://openrouter.ai/api/v1/chat/completions';

  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: promptText }
      ]
    }
  ];

  for (const imgBase64 of images) {
    messages[0].content.push({
      type: 'image_url',
      image_url: {
        url: `data:image/jpeg;base64,${imgBase64}`
      }
    } as any);
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openRouterKey}`,
      'HTTP-Referer': 'https://pdf-ocr-web.pages.dev/',
      'X-Title': 'PDF OCR'
    },
    body: JSON.stringify({
      model: targetModel,
      messages,
      temperature: 0.1,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
  }

  const data = await response.json() as any;
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("Invalid empty response from OpenRouter");
  }
  return text;
}

async function callGroq(images: string[], model: string, apiKey: string): Promise<string> {
  const apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
  const targetModel = model || 'llama-3.3-70b-versatile';

  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: promptText }
      ]
    }
  ];

  for (const imgBase64 of images) {
    messages[0].content.push({
      type: 'image_url',
      image_url: {
        url: `data:image/jpeg;base64,${imgBase64}`
      }
    } as any);
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: targetModel,
      messages,
      temperature: 0.1
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error: ${response.status} ${errorText}`);
  }

  const data = await response.json() as any;
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("Invalid empty response from Groq");
  }
  return text;
}

async function incrementStats(db: any, success: boolean, count: number) {
  if (!db) {
    console.warn("D1 database binding not found!");
    return;
  }
  // Lấy ngày hiện tại múi giờ Việt Nam (UTC+7)
  const vnDateStr = new Date(new Date().getTime() + 7 * 3600 * 1000).toISOString().split('T')[0];
  const totalVal = count;
  const successVal = success ? count : 0;
  const failedVal = success ? 0 : count;

  try {
    await db.prepare(
      `INSERT INTO stats (date, total, success, failed) 
       VALUES (?1, ?2, ?3, ?4) 
       ON CONFLICT(date) 
       DO UPDATE SET 
         total = stats.total + ?2, 
         success = stats.success + ?3, 
         failed = stats.failed + ?4`
    )
    .bind(vnDateStr, totalVal, successVal, failedVal)
    .run();
    console.log(`Stats logged in D1: date=${vnDateStr}, success=${success}, count=${count}`);
  } catch (err: any) {
    console.error("Failed to write to D1 Database:", err.message);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Xử lý thống kê API
    if (url.pathname === '/api/stats') {
      try {
        if (!env.DB) {
          return new Response(JSON.stringify({ error: "D1 Database binding missing" }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        const summary = await env.DB.prepare('SELECT SUM(total) as total, SUM(success) as success, SUM(failed) as failed FROM stats').first();
        const { results } = await env.DB.prepare('SELECT date, total, success, failed FROM stats ORDER BY date ASC LIMIT 100').all();
        
        return new Response(JSON.stringify({
          summary: {
            total: summary?.total || 0,
            success: summary?.success || 0,
            failed: summary?.failed || 0
          },
          daily: results || []
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    if (url.pathname === '/api/stats-increment') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405, headers: corsHeaders });
      }
      try {
        const body = await request.json() as any;
        const { success, count } = body;
        await incrementStats(env.DB, !!success, count || 1);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    if (request.method !== 'POST' || url.pathname !== '/api/extract') {
      return new Response('Not found', { status: 404, headers: corsHeaders });
    }

    try {
      const body = await request.json() as any;
      const { images, model, provider } = body;

      if (!images || !Array.isArray(images) || images.length === 0) {
        return new Response(JSON.stringify({ error: 'No images provided' }), { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      let targetProvider = provider || 'gemini'; // Ưu tiên Gemini mặc định
      let targetModel = model;
      let textResponse = '';

      // Tự chuẩn bị tập hợp các key Gemini cần thử
      let geminiKeysToTry = [...GEMINI_KEYS];
      if (env.GEMINI_API_KEY) {
        geminiKeysToTry.unshift(env.GEMINI_API_KEY);
      }

      // Danh sách các nhà cung cấp/mô hình sẽ quay vòng thử nếu lỗi
      const providersToTry = [];
      if (targetProvider === 'gemini') {
        providersToTry.push({ name: 'gemini', model: targetModel || 'gemini-2.5-flash' });
        if (targetModel !== 'gemini-3.5-flash') providersToTry.push({ name: 'gemini', model: 'gemini-3.5-flash' });
        providersToTry.push({ name: 'gemini', model: 'gemini-3-flash-preview' });
        providersToTry.push({ name: 'gemini', model: 'gemini-3.1-flash-lite-preview' });
        providersToTry.push({ name: 'gemini', model: 'gemini-2.5-flash-lite' });
        
        providersToTry.push({ name: 'openrouter', model: 'google/gemini-2.5-flash:free' });
        providersToTry.push({ name: 'groq', model: 'llama-3.3-70b-versatile' });
      } else if (targetProvider === 'openrouter') {
        providersToTry.push({ name: 'openrouter', model: targetModel || 'google/gemini-2.5-flash:free' });
        providersToTry.push({ name: 'gemini', model: 'gemini-2.5-flash' });
        providersToTry.push({ name: 'gemini', model: 'gemini-3.5-flash' });
        providersToTry.push({ name: 'gemini', model: 'gemini-3-flash-preview' });
        providersToTry.push({ name: 'gemini', model: 'gemini-3.1-flash-lite-preview' });
        providersToTry.push({ name: 'gemini', model: 'gemini-2.5-flash-lite' });
        
        providersToTry.push({ name: 'groq', model: 'llama-3.3-70b-versatile' });
      } else { // groq
        providersToTry.push({ name: 'groq', model: targetModel || 'llama-3.3-70b-versatile' });
        providersToTry.push({ name: 'gemini', model: 'gemini-2.5-flash' });
        providersToTry.push({ name: 'gemini', model: 'gemini-3.5-flash' });
        providersToTry.push({ name: 'gemini', model: 'gemini-3-flash-preview' });
        providersToTry.push({ name: 'gemini', model: 'gemini-3.1-flash-lite-preview' });
        providersToTry.push({ name: 'gemini', model: 'gemini-2.5-flash-lite' });
        
        providersToTry.push({ name: 'openrouter', model: 'google/gemini-2.5-flash:free' });
      }

      let lastError: any = null;
      let successProvider = '';
      let successModel = '';
      for (const prov of providersToTry) {
        try {
          console.log(`Đang chạy luồng nhận dạng bằng ${prov.name} (${prov.model})...`);
          if (prov.name === 'gemini') {
            textResponse = await tryGeminiWithKeyRotation(images, prov.model, geminiKeysToTry);
          } else if (prov.name === 'openrouter') {
            textResponse = await callOpenRouter(images, prov.model, env.OPENROUTER_API_KEY);
          } else if (prov.name === 'groq') {
            const groqKey = env.GROQ_API_KEY || HARDCODED_GROQ_KEY;
            if (!groqKey) {
              throw new Error("Thiếu API Key cho Groq.");
            }
            textResponse = await callGroq(images, prov.model, groqKey);
          }

          if (textResponse) {
            successProvider = prov.name;
            successModel = prov.model;
            break; // Đã trích xuất thành công
          }
        } catch (err: any) {
          console.error(`Lỗi từ kênh ${prov.name}: ${err.message}. Tự động xoay sang kênh khác...`);
          lastError = err;
        }
      }

      if (!textResponse) {
        throw lastError || new Error("Tất cả các mô hình và nhà cung cấp API đều thất bại.");
      }

      // Bóc tách JSON an toàn tránh lỗi markdown text thừa
      let cleanJsonText = '';
      try {
        const startIndex = textResponse.indexOf('{');
        const endIndex = textResponse.lastIndexOf('}');
        if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
          cleanJsonText = textResponse.substring(startIndex, endIndex + 1);
          const parsedObj = JSON.parse(cleanJsonText) as any;
          parsedObj.usedProvider = successProvider;
          parsedObj.usedModel = successModel;
          cleanJsonText = JSON.stringify(parsedObj);
        } else {
          cleanJsonText = textResponse.replace(/```json\n?|\n?```/g, '').trim();
          const parsedObj = JSON.parse(cleanJsonText) as any;
          parsedObj.usedProvider = successProvider;
          parsedObj.usedModel = successModel;
          cleanJsonText = JSON.stringify(parsedObj);
        }
      } catch (e) {
        console.error('Failed to parse JSON directly:', textResponse);
        // Fallback: gán chuỗi thô vào trường noiDung để tránh crash UI của client
        cleanJsonText = JSON.stringify({
          soDen: '',
          soKyHieu: '',
          noiDung: textResponse.slice(0, 1000), 
          ngayVBDen: '',
          thoiHanGiaiQuyet: '',
          yKienChiDao: '',
          tienDoGiaiQuyet: '',
          soKyHieuVBTraLoi: '',
          usedProvider: successProvider,
          usedModel: successModel
        });
      }

      ctx.waitUntil(incrementStats(env.DB, true, 1));

      return new Response(cleanJsonText, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error: any) {
      console.error(error);
      ctx.waitUntil(incrementStats(env.DB, false, 1));
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};
