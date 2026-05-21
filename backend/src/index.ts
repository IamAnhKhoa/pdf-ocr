export interface Env {
  GEMINI_API_KEY?: string;
  GEMINI_KEYS?: string;
  GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  VERCEL_PROXY_URL?: string; // URL Vercel backend để proxy khi Edge bị chặn địa lý
  DB?: any;
}

function getGeminiKeys(env: Env): string[] {
  const keys: string[] = [];
  if (env.GEMINI_API_KEY) {
    keys.push(env.GEMINI_API_KEY);
  }
  if (env.GEMINI_KEYS) {
    const list = env.GEMINI_KEYS.split(',').map(k => k.trim()).filter(Boolean);
    keys.push(...list);
  }
  return [...new Set(keys)];
}

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

// Gọi OCR qua Vercel proxy để bypass lỗi IP địa lý của Cloudflare Edge
async function callViaVercelProxy(images: string[], model: string, provider: string, vercelUrl: string, env: Env): Promise<string> {
  const proxyEndpoint = `${vercelUrl}/api/extract`;
  console.log(`Proxy OCR qua Vercel: ${proxyEndpoint}`);

  // Gửi toàn bộ keys vào header để Vercel xử lý xoay vòng key
  const geminiKeys = getGeminiKeys(env).join(',');

  const resp = await fetch(proxyEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gemini-Keys': geminiKeys,
      'X-Openrouter-Key': env.OPENROUTER_API_KEY || '',
      'X-Groq-Key': env.GROQ_API_KEY || '',
      'User-Agent': 'Mozilla/5.0 (compatible; pdf-ocr-worker/1.0)'
    },
    body: JSON.stringify({ images, model, provider })
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Vercel proxy error: ${resp.status} ${errText}`);
  }

  const data = await resp.text();
  return data; // Vercel trả về JSON string trực tiếp
}

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
        // Nếu lỗi địa lý → ném error đặc biệt để caller biết cần dùng proxy
        if (errorText.includes('location') || errorText.includes('USER_LOCATION')) {
          throw new Error(`GEO_BLOCK:Gemini Key ${i + 1}: ${errorText}`);
        }
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
      'Authorization': `Bearer ${apiKey}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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

    if (url.pathname === '/api/check-quota') {
      const results: any[] = [];

      const parseResetTime = (resp: Response) => {
        const groqReset = resp.headers.get('x-ratelimit-reset-requests') || resp.headers.get('x-ratelimit-reset-tokens');
        if (groqReset) return `Reset sau: ${groqReset}`;

        const retryAfter = resp.headers.get('retry-after');
        if (retryAfter) {
          const secs = parseInt(retryAfter, 10);
          if (!isNaN(secs)) {
            if (secs < 60) return `Reset sau: ${secs}s`;
            if (secs < 3600) return `Reset sau: ${Math.ceil(secs/60)} phút`;
            return `Reset sau: ${Math.ceil(secs/3600)} giờ`;
          }
          const resetDate = new Date(retryAfter);
          if (!isNaN(resetDate.getTime())) return `Reset lúc: ${resetDate.toLocaleTimeString('vi-VN')}`;
        }

        const rlReset = resp.headers.get('x-ratelimit-reset') || resp.headers.get('x-ratelimit-reset-requests');
        if (rlReset) {
          const ts = parseInt(rlReset, 10);
          if (!isNaN(ts)) {
            const resetDate = new Date(ts * 1000);
            const diffSecs = Math.max(0, Math.round((resetDate.getTime() - Date.now()) / 1000));
            if (diffSecs < 60) return `Reset sau: ${diffSecs}s`;
            if (diffSecs < 3600) return `Reset sau: ${Math.ceil(diffSecs/60)} phút`;
            return `Reset lúc: ${resetDate.toLocaleTimeString('vi-VN')}`;
          }
        }
        return 'Reset hàng ngày';
      };

      const geminiModelsToTest = [
        { id: 'gemini-2.5-flash', name: '2.5 Flash', limit: '5 RPM · 20 RPD · 250K TPM' },
        { id: 'gemini-3.5-flash', name: '3.5 Flash', limit: '5 RPM · 20 RPD · 250K TPM' },
        { id: 'gemini-3-flash-preview', name: '3 Flash', limit: '5 RPM · 20 RPD · 250K TPM' },
        { id: 'gemini-3.1-flash-lite-preview', name: '3.1 Flash Lite', limit: '15 RPM · 500 RPD · 250K TPM' },
        { id: 'gemini-2.5-flash-lite', name: '2.5 Flash Lite', limit: '10 RPM · 20 RPD · 250K TPM' }
      ];

      const geminiKeysAll = getGeminiKeys(env);

      for (let i = 0; i < geminiKeysAll.length; i++) {
        const key = geminiKeysAll[i];
        const label = `Gemini Key ${i + 1}`;
        
        let keyChecked = false;
        let lastErrMessage = '';
        
        for (const modelSpec of geminiModelsToTest) {
          const startTime = Date.now();
          try {
            const resp = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${modelSpec.id}:generateContent?key=${key}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }], generationConfig: { temperature: 0, maxOutputTokens: 5 } })
              }
            );
            const latency = Date.now() - startTime;

            if (resp.ok) {
              const isMainModel = modelSpec.id === 'gemini-2.5-flash';
              results.push({
                name: label,
                provider: 'gemini',
                status: 'ok',
                message: isMainModel ? `Hoạt động tốt (HTTP ${resp.status})` : `Dự phòng ${modelSpec.name} (HTTP 200)`,
                latency,
                resetInfo: `⏱ Free: ${modelSpec.limit} · Reset RPD: 15:00 VN (00:00 PT)`,
                details: `Phản hồi: ${latency}ms | Model hoạt động: ${modelSpec.id}`
              });
              keyChecked = true;
              break; 
            } else {
              const errBody = await resp.json().catch(() => ({})) as any;
              lastErrMessage = errBody?.error?.message || `HTTP ${resp.status}`;
              
              const isQuota = resp.status === 429 || lastErrMessage.toLowerCase().includes('quota') || lastErrMessage.toLowerCase().includes('limit');
              
              if (isQuota) {
                console.log(`${label} - Model ${modelSpec.id} bị 429. Thử model tiếp theo...`);
              } else {
                results.push({
                  name: label,
                  provider: 'gemini',
                  status: 'error',
                  message: lastErrMessage,
                  latency,
                  resetInfo: 'API Key không hợp lệ / Lỗi cấu hình',
                  details: `HTTP ${resp.status} | Phản hồi: ${latency}ms`
                });
                keyChecked = true;
                break;
              }
            }
          } catch (e: any) {
            lastErrMessage = e.message;
            console.error(`Lỗi test ${modelSpec.id} trên ${label}:`, e.message);
          }
        }

        if (!keyChecked) {
          results.push({
            name: label,
            provider: 'gemini',
            status: 'quota',
            message: 'Hết hạn mức tất cả model free',
            latency: 0,
            resetInfo: 'Hồi RPM sau 1m · Hồi RPD lúc 15:00 VN',
            details: `Cả 5 model đều bị giới hạn 429 | Lỗi cuối: ${lastErrMessage}`
          });
        }
      }

      const orStartTime = Date.now();
      try {
        const orKey = env.OPENROUTER_API_KEY || HARDCODED_OPENROUTER_KEY;
        if (!orKey) {
          throw new Error("Thiếu API Key cho OpenRouter.");
        }
        const resp = await fetch('https://openrouter.ai/api/v1/auth/key', {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${orKey}` }
        });
        const latency = Date.now() - orStartTime;
        if (resp.ok) {
          const data = await resp.json().catch(() => ({})) as any;
          const keyData = data?.data || {};
          const usage = keyData.usage != null ? (keyData.usage / 100).toFixed(4) : '0';
          const limit = keyData.limit != null ? (keyData.limit / 100).toFixed(2) : 'Không giới hạn';
          
          let limitMsg = '';
          if (keyData.is_free_tier) {
            limitMsg = 'Free tier (Giới hạn: 20 req/phút)';
          } else {
            limitMsg = `Đã dùng: $${usage} / $${limit}`;
          }

          results.push({
            name: 'OpenRouter.ai',
            provider: 'openrouter',
            status: 'ok',
            message: 'Hoạt động tốt (HTTP 200)',
            latency,
            resetInfo: limitMsg,
            details: `Phản hồi: ${latency}ms | Model: google/gemini-2.5-flash:free`
          });
        } else {
          const errBody = await resp.json().catch(() => ({})) as any;
          const msg = errBody?.error?.message || `HTTP ${resp.status}`;
          results.push({
            name: 'OpenRouter.ai',
            provider: 'openrouter',
            status: 'error',
            message: msg,
            latency,
            resetInfo: 'Lỗi kết nối / Key sai',
            details: `HTTP ${resp.status} | Phản hồi: ${latency}ms`
          });
        }
      } catch (e: any) {
        results.push({
          name: 'OpenRouter.ai',
          provider: 'openrouter',
          status: 'error',
          message: e.message,
          latency: Date.now() - orStartTime,
          resetInfo: 'Không cấu hình key / Lỗi kết nối',
          details: 'Vui lòng kiểm tra biến OPENROUTER_API_KEY'
        });
      }

      const groqStartTime = Date.now();
      try {
        const groqKey = env.GROQ_API_KEY || HARDCODED_GROQ_KEY;
        if (!groqKey) {
          throw new Error("Thiếu API Key cho Groq.");
        }
        const resp = await fetch('https://api.groq.com/openai/v1/models', {
          method: 'GET',
          headers: { 
            'Authorization': `Bearer ${groqKey}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        const latency = Date.now() - groqStartTime;
        if (resp.ok) {
          const reqRemaining = resp.headers.get('x-ratelimit-remaining-requests');
          const reqLimit = resp.headers.get('x-ratelimit-limit-requests');
          const reqReset = resp.headers.get('x-ratelimit-reset-requests');
          
          const tokRemaining = resp.headers.get('x-ratelimit-remaining-tokens');
          const tokLimit = resp.headers.get('x-ratelimit-limit-tokens');
          const tokReset = resp.headers.get('x-ratelimit-reset-tokens');

          results.push({
            name: 'Groq Cloud',
            provider: 'groq',
            status: 'ok',
            message: 'Hoạt động tốt (HTTP 200)',
            latency,
            resetInfo: reqRemaining ? `Request: Còn ${reqRemaining}/${reqLimit} (reset ${reqReset})` : 'Hoạt động tốt',
            details: `Phản hồi: ${latency}ms | Token: Còn ${tokRemaining || 'N/A'}/${tokLimit || 'N/A'} (reset ${tokReset || 'N/A'})`
          });
        } else {
          const errBody = await resp.json().catch(() => ({})) as any;
          const msg = errBody?.error?.message || `HTTP ${resp.status}`;
          const isQuota = resp.status === 429 || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('rate') || msg.toLowerCase().includes('limit');
          
          const reqReset = resp.headers.get('x-ratelimit-reset-requests') || resp.headers.get('x-ratelimit-reset-tokens');

          results.push({
            name: 'Groq Cloud',
            provider: 'groq',
            status: isQuota ? 'quota' : 'error',
            message: isQuota ? 'Bị giới hạn tốc độ (Rate Limit 429)' : msg,
            latency,
            resetInfo: isQuota ? `Reset sau: ${reqReset || 'vài giây'}` : 'Lỗi kết nối / Key sai',
            details: `HTTP ${resp.status} | Phản hồi: ${latency}ms`
          });
        }
      } catch (e: any) {
        results.push({
          name: 'Groq Cloud',
          provider: 'groq',
          status: 'error',
          message: e.message,
          latency: Date.now() - groqStartTime,
          resetInfo: 'Không cấu hình key / Lỗi kết nối',
          details: 'Vui lòng kiểm tra biến GROQ_API_KEY'
        });
      }

      return new Response(JSON.stringify({ results, checkedAt: new Date().toISOString() }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
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
      let geminiKeysToTry = getGeminiKeys(env);

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
      const vercelProxyUrl = env.VERCEL_PROXY_URL || 'https://backend-alpha-rose-53.vercel.app';

      for (const prov of providersToTry) {
        try {
          console.log(`Đang chạy luồng nhận dạng bằng ${prov.name} (${prov.model})...`);
          if (prov.name === 'gemini') {
            try {
              textResponse = await tryGeminiWithKeyRotation(images, prov.model, geminiKeysToTry);
            } catch (geminiErr: any) {
              // Nếu tất cả key Gemini bị lỗi địa lý → thử qua Vercel proxy
              if (geminiErr.message?.includes('GEO_BLOCK') || geminiErr.message?.includes('location')) {
                console.log('Phát hiện lỗi địa lý Gemini. Chuyển sang Vercel proxy...');
                const proxyResult = await callViaVercelProxy(images, prov.model, 'gemini', vercelProxyUrl, env);
                // Vercel trả về JSON text, parse để lấy text field hoặc dùng trực tiếp
                try {
                  const parsed = JSON.parse(proxyResult);
                  // Nếu là JSON kết quả hợp lệ (có ít nhất 1 trường OCR) thì dùng luôn
                  if (parsed.soDen !== undefined || parsed.soKyHieu !== undefined || parsed.noiDung !== undefined) {
                    successProvider = 'gemini-via-vercel';
                    successModel = prov.model;
                    // Gắn thông tin provider
                    parsed.usedProvider = 'gemini-via-vercel';
                    parsed.usedModel = prov.model;
                    // Lưu stats và trả về ngay
                    await incrementStats(env.DB, true, images.length);
                    return new Response(JSON.stringify(parsed), {
                      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                  }
                  // Nếu Vercel trả về dạng {candidates: [...]} raw Gemini
                  const candidates = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                  if (candidates) textResponse = candidates;
                  else textResponse = proxyResult;
                } catch {
                  textResponse = proxyResult;
                }
              } else {
                throw geminiErr;
              }
            }
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
