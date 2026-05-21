export const config = {
  runtime: 'edge',
};

function getGeminiKeys() {
  const keys = [];
  if (process.env.GEMINI_API_KEY) {
    keys.push(process.env.GEMINI_API_KEY);
  }
  if (process.env.GEMINI_KEYS) {
    const list = process.env.GEMINI_KEYS.split(',').map(k => k.trim()).filter(Boolean);
    keys.push(...list);
  }
  return [...new Set(keys)];
}

const HARDCODED_OPENROUTER_KEY = "";
const HARDCODED_GROQ_KEY = "";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Gemini-Keys, X-Openrouter-Key, X-Groq-Key',
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

async function tryGeminiWithKeyRotation(images, model, keysToTry) {
  let lastError = null;
  const targetModel = model || 'gemini-2.5-flash';

  for (let i = 0; i < keysToTry.length; i++) {
    const currentKey = keysToTry[i];
    try {
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${currentKey}`;
      const parts = [{ text: promptText }];
      
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

      const geminiData = await geminiResponse.json();
      const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!text) {
        throw new Error(`Empty response from Gemini Key ${i + 1}`);
      }

      return text;
    } catch (err) {
      console.error(`Gemini rotation step ${i + 1} error:`, err.message);
      lastError = err;
    }
  }

  throw lastError || new Error("Tất cả key API Gemini đều thất bại.");
}

async function callOpenRouter(images, model, customKey) {
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
    });
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

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("Invalid empty response from OpenRouter");
  }
  return text;
}

async function callGroq(images, model, apiKey) {
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
    });
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

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("Invalid empty response from Groq");
  }
  return text;
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);

  // Cho phép check-quota từ bất kỳ method nào (GET hoặc POST)
  if (url.pathname === '/api/check-quota') {
    const results = [];

    // Hàm tính thời gian reset dễ đọc từ các loại header khác nhau
    const parseResetTime = (resp) => {
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
        if (!isNaN(resetDate)) return `Reset lúc: ${resetDate.toLocaleTimeString('vi-VN')}`;
      }

      const rlReset = resp.headers.get('x-ratelimit-reset') || resp.headers.get('x-ratelimit-reset-requests');
      if (rlReset) {
        const ts = parseInt(rlReset, 10);
        if (!isNaN(ts)) {
          const resetDate = new Date(ts * 1000);
          const diffSecs = Math.max(0, Math.round((resetDate - Date.now()) / 1000));
          if (diffSecs < 60) return `Reset sau: ${diffSecs}s`;
          if (diffSecs < 3600) return `Reset sau: ${Math.ceil(diffSecs/60)} phút`;
          return `Reset lúc: ${resetDate.toLocaleTimeString('vi-VN')}`;
        }
      }
      return 'Reset hàng ngày';
    };

    // Kiểm tra từng Gemini key
    // Danh sách các model free cần kiểm tra tuần tự
    const geminiModelsToTest = [
      { id: 'gemini-2.5-flash', name: '2.5 Flash', limit: '5 RPM · 20 RPD · 250K TPM' },
      { id: 'gemini-3.5-flash', name: '3.5 Flash', limit: '5 RPM · 20 RPD · 250K TPM' },
      { id: 'gemini-3-flash-preview', name: '3 Flash', limit: '5 RPM · 20 RPD · 250K TPM' },
      { id: 'gemini-3.1-flash-lite-preview', name: '3.1 Flash Lite', limit: '15 RPM · 500 RPD · 250K TPM' },
      { id: 'gemini-2.5-flash-lite', name: '2.5 Flash Lite', limit: '10 RPM · 20 RPD · 250K TPM' }
    ];

    // Nhận keys từ header nếu được gọi bởi Cloudflare Worker proxy
    const headerGeminiKeysQ = request.headers.get('X-Gemini-Keys');
    const headerOpenrouterKeyQ = request.headers.get('X-Openrouter-Key');
    const headerGroqKeyQ = request.headers.get('X-Groq-Key');

    // Ưu tiên keys từ header (từ Cloudflare Worker) hơn env vars
    let geminiKeysAll;
    if (headerGeminiKeysQ) {
      const headerKeys = headerGeminiKeysQ.split(',').map(k => k.trim()).filter(Boolean);
      const envKeys = getGeminiKeys();
      geminiKeysAll = [...new Set([...headerKeys, ...envKeys])];
    } else {
      geminiKeysAll = getGeminiKeys();
    }

    for (let i = 0; i < geminiKeysAll.length; i++) {
      const key = geminiKeysAll[i];
      const label = `Gemini Key ${i + 1}`;
      
      let keyChecked = false;
      let lastErrMessage = '';
      let lastErrStatus = 500;
      let lastResetTime = '';

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
            // Model này hoạt động tốt!
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
            break; // Đã tìm thấy model chạy tốt, dừng check key này
          } else {
            const errBody = await resp.json().catch(() => ({}));
            lastErrMessage = errBody?.error?.message || `HTTP ${resp.status}`;
            lastErrStatus = resp.status;
            
            const isQuota = resp.status === 429 || lastErrMessage.toLowerCase().includes('quota') || lastErrMessage.toLowerCase().includes('limit');
            
            if (isQuota) {
              lastResetTime = parseResetTime(resp);
              // Lỗi rate limit, tiếp tục vòng lặp thử model tiếp theo
              console.log(`${label} - Model ${modelSpec.id} bị 429. Thử model tiếp theo...`);
            } else {
              // Lỗi nghiêm trọng khác (như API key invalid), dừng check các model khác ngay lập tức
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
        } catch (e) {
          lastErrMessage = e.message;
          console.error(`Lỗi test ${modelSpec.id} trên ${label}:`, e.message);
        }
      }

      // Nếu duyệt hết tất cả model mà không có cái nào chạy được
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

    // Kiểm tra OpenRouter
    const orStartTime = Date.now();
    try {
      const orKey = headerOpenrouterKeyQ || process.env.OPENROUTER_API_KEY || HARDCODED_OPENROUTER_KEY;
      const resp = await fetch('https://openrouter.ai/api/v1/auth/key', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${orKey}` }
      });
      const latency = Date.now() - orStartTime;
      if (resp.ok) {
        const data = await resp.json().catch(() => ({}));
        const keyData = data?.data || {};
        const label = keyData.label || 'Chưa đặt tên';
        const usage = keyData.usage != null ? (keyData.usage / 100).toFixed(4) : '0';
        const limit = keyData.limit != null ? (keyData.limit / 100).toFixed(2) : 'Không giới hạn';
        
        let limitMsg = '';
        if (keyData.is_free_tier) {
          limitMsg = 'Free tier (Giới hạn: 20 req/phút)';
        } else {
          limitMsg = `Đã dùng: $${usage} / $${limit}`;
        }

        const rateLimitDetail = keyData.rate_limit
          ? `Tốc độ: ${keyData.rate_limit.requests} req / ${keyData.rate_limit.interval}`
          : 'Không giới hạn tốc độ';

        results.push({
          name: 'OpenRouter',
          provider: 'openrouter',
          status: 'ok',
          message: `Hoạt động tốt (${label})`,
          latency,
          resetInfo: limitMsg,
          details: `Phản hồi: ${latency}ms | ${rateLimitDetail}`
        });
      } else {
        const errBody = await resp.json().catch(() => ({}));
        const msg = errBody?.error?.message || `HTTP ${resp.status}`;
        const isQuota = resp.status === 429 || resp.status === 402;
        results.push({
          name: 'OpenRouter',
          provider: 'openrouter',
          status: isQuota ? 'quota' : 'error',
          message: isQuota ? 'Hết hạn mức / Tài khoản hết số dư' : msg,
          latency,
          resetInfo: isQuota ? 'Cần nạp thêm tiền hoặc đổi key' : 'Key không hợp lệ',
          details: `HTTP ${resp.status} | Phản hồi: ${latency}ms`
        });
      }
    } catch (e) {
      results.push({
        name: 'OpenRouter',
        provider: 'openrouter',
        status: 'error',
        message: e.message,
        latency: Date.now() - orStartTime,
        resetInfo: 'Lỗi mạng',
        details: 'Không thể kết nối đến openrouter.ai'
      });
    }

    // Kiểm tra Groq
    const groqStartTime = Date.now();
    try {
      const groqKey = headerGroqKeyQ || process.env.GROQ_API_KEY || HARDCODED_GROQ_KEY;
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${groqKey}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 })
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
        const errBody = await resp.json().catch(() => ({}));
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
    } catch (e) {
      results.push({
        name: 'Groq Cloud',
        provider: 'groq',
        status: 'error',
        message: e.message,
        latency: Date.now() - groqStartTime,
        resetInfo: 'Lỗi mạng',
        details: 'Không thể kết nối đến api.groq.com'
      });
    }

    return new Response(JSON.stringify({ results, checkedAt: new Date().toISOString() }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // ── Route: POST /api/extract ─────────────────────────────────────────────
  if (request.method !== 'POST' || url.pathname !== '/api/extract') {
    return new Response('Not found', { status: 404, headers: corsHeaders });
  }

  try {
    const body = await request.json();
    const { images, model, provider } = body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return new Response(JSON.stringify({ error: 'No images provided' }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    let targetProvider = provider || 'gemini';
    let targetModel = model;
    let textResponse = '';

    // Nhận keys từ header nếu được gọi bởi Cloudflare Worker proxy
    const headerGeminiKeys = request.headers.get('X-Gemini-Keys');
    const headerOpenrouterKey = request.headers.get('X-Openrouter-Key');
    const headerGroqKey = request.headers.get('X-Groq-Key');

    // Tự chuẩn bị tập hợp các key Gemini cần thử (ưu tiên keys từ header)
    let geminiKeysToTry;
    if (headerGeminiKeys) {
      const headerKeys = headerGeminiKeys.split(',').map(k => k.trim()).filter(Boolean);
      const envKeys = getGeminiKeys();
      geminiKeysToTry = [...new Set([...headerKeys, ...envKeys])];
    } else {
      geminiKeysToTry = getGeminiKeys();
    }

    // Danh sách các nhà cung cấp/mô hình sẽ quay vòng thử nếu lỗi
    const providersToTry = [];
    if (targetProvider === 'gemini') {
      // Gemini direct (Vercel IP sạch, không bị block địa lý)
      providersToTry.push({ name: 'gemini', model: targetModel || 'gemini-2.5-flash' });
      if (targetModel !== 'gemini-2.5-flash') providersToTry.push({ name: 'gemini', model: 'gemini-2.5-flash' });
      providersToTry.push({ name: 'gemini', model: 'gemini-2.5-flash-lite' });
      // OpenRouter vision models (số lượng tối đa)
      providersToTry.push({ name: 'openrouter', model: 'qwen/qwen2.5-vl-72b-instruct:free' });   // OCR tốt nhất
      providersToTry.push({ name: 'openrouter', model: 'meta-llama/llama-4-maverick:free' });     // Vision, tốc độ cao
      providersToTry.push({ name: 'openrouter', model: 'meta-llama/llama-4-scout:free' });        // Vision, nhẹ hơn
      providersToTry.push({ name: 'openrouter', model: 'google/gemini-2.5-flash:free' });         // Gemini qua OpenRouter
      // Groq vision models
      providersToTry.push({ name: 'groq', model: 'llama-3.2-90b-vision-preview' });              // Groq vision chất lượng cao
      providersToTry.push({ name: 'groq', model: 'llama-3.2-11b-vision-preview' });              // Groq vision nhanh
    } else if (targetProvider === 'openrouter') {
      // Xoay vòng OpenRouter vision models tối đa
      providersToTry.push({ name: 'openrouter', model: targetModel || 'qwen/qwen2.5-vl-72b-instruct:free' });
      providersToTry.push({ name: 'openrouter', model: 'meta-llama/llama-4-maverick:free' });
      providersToTry.push({ name: 'openrouter', model: 'meta-llama/llama-4-scout:free' });
      providersToTry.push({ name: 'openrouter', model: 'google/gemini-2.5-flash:free' });
      // Fallback Gemini direct
      providersToTry.push({ name: 'gemini', model: 'gemini-2.5-flash' });
      providersToTry.push({ name: 'gemini', model: 'gemini-2.5-flash-lite' });
      // Groq vision
      providersToTry.push({ name: 'groq', model: 'llama-3.2-90b-vision-preview' });
      providersToTry.push({ name: 'groq', model: 'llama-3.2-11b-vision-preview' });
    } else { // groq
      // Groq vision models ưu tiên
      providersToTry.push({ name: 'groq', model: targetModel || 'llama-3.2-90b-vision-preview' });
      providersToTry.push({ name: 'groq', model: 'llama-3.2-11b-vision-preview' });
      // Fallback Gemini + OpenRouter vision
      providersToTry.push({ name: 'gemini', model: 'gemini-2.5-flash' });
      providersToTry.push({ name: 'openrouter', model: 'qwen/qwen2.5-vl-72b-instruct:free' });
      providersToTry.push({ name: 'openrouter', model: 'meta-llama/llama-4-maverick:free' });
      providersToTry.push({ name: 'openrouter', model: 'google/gemini-2.5-flash:free' });
    }

    let lastError = null;
    let successProvider = '';
    let successModel = '';
    for (const prov of providersToTry) {
      try {
        console.log(`Đang chạy luồng nhận dạng bằng ${prov.name} (${prov.model})...`);
        if (prov.name === 'gemini') {
          textResponse = await tryGeminiWithKeyRotation(images, prov.model, geminiKeysToTry);
        } else if (prov.name === 'openrouter') {
          textResponse = await callOpenRouter(images, prov.model, headerOpenrouterKey || process.env.OPENROUTER_API_KEY);
        } else if (prov.name === 'groq') {
          const groqKey = headerGroqKey || process.env.GROQ_API_KEY || HARDCODED_GROQ_KEY;
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
      } catch (err) {
        console.error(`Lỗi từ kênh ${prov.name}: ${err.message}. Tự động xoay sang kênh khác...`);
        lastError = err;
      }
    }

    if (!textResponse) {
      throw lastError || new Error("Tất cả các mô hình và nhà cung cấp API đều thất bại.");
    }

    let cleanJsonText = '';
    try {
      const startIndex = textResponse.indexOf('{');
      const endIndex = textResponse.lastIndexOf('}');
      if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
        cleanJsonText = textResponse.substring(startIndex, endIndex + 1);
        const parsedObj = JSON.parse(cleanJsonText);
        parsedObj.usedProvider = successProvider;
        parsedObj.usedModel = successModel;
        cleanJsonText = JSON.stringify(parsedObj);
      } else {
        cleanJsonText = textResponse.replace(/```json\n?|\n?```/g, '').trim();
        const parsedObj = JSON.parse(cleanJsonText);
        parsedObj.usedProvider = successProvider;
        parsedObj.usedModel = successModel;
        cleanJsonText = JSON.stringify(parsedObj);
      }
    } catch (e) {
      console.error('Failed to parse JSON directly:', textResponse);
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

    // Báo cáo thống kê ngầm (không block response của người dùng)
    try {
      fetch('https://pdf-ocr-backend.sockladien.workers.dev/api/stats-increment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, count: 1 })
      }).catch(e => console.error('Stats report err:', e.message));
    } catch (e) {}

    return new Response(cleanJsonText, {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error(error);
    
    // Báo cáo thống kê thất bại ngầm
    try {
      fetch('https://pdf-ocr-backend.sockladien.workers.dev/api/stats-increment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, count: 1 })
      }).catch(e => console.error('Stats report err:', e.message));
    } catch (e) {}

    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
