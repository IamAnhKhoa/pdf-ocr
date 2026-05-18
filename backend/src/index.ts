export interface Env {
  GEMINI_API_KEY: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST' || new URL(request.url).pathname !== '/api/extract') {
      return new Response('Not found', { status: 404, headers: corsHeaders });
    }

    try {
      if (!env.GEMINI_API_KEY) {
        throw new Error('Missing GEMINI_API_KEY');
      }

      const body = await request.json() as any;
      const { images } = body; // Array of base64 strings (without data:image/jpeg;base64, prefix)

      if (!images || !Array.isArray(images) || images.length === 0) {
        return new Response(JSON.stringify({ error: 'No images provided' }), { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      const parts: any[] = [
        {
          text: `Bạn là một trợ lý ảo chuyên trích xuất thông tin từ văn bản scan. 
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
Nếu không tìm thấy thông tin nào, hãy để chuỗi rỗng "".`
        }
      ];

      for (const imgBase64 of images) {
        parts.push({
          inline_data: {
            mime_type: 'image/jpeg',
            data: imgBase64
          }
        });
      }

      const model = 'gemini-1.5-flash';
      const apiUrl = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

      const geminiResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.1
          }
        })
      });

      if (!geminiResponse.ok) {
        const errorText = await geminiResponse.text();
        throw new Error(`Gemini API error: ${geminiResponse.status} ${errorText}`);
      }

      const geminiData = await geminiResponse.json() as any;
      const textResponse = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textResponse) {
        throw new Error('Invalid response from Gemini');
      }

      return new Response(textResponse, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error: any) {
      console.error(error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};
