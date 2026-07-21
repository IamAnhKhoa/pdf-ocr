import * as pdfjsLib from 'pdfjs-dist';

// Thiết lập workerSrc cho PDF.js bên trong Web Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

self.onmessage = async (e) => {
  const { id, arrayBuffer, scale = 1.5, quality = 0.75 } = e.data;
  if (!arrayBuffer) {
    self.postMessage({ id, status: 'error', error: 'Dữ liệu file không hợp lệ' });
    return;
  }

  try {
    const loadingTask = pdfjsLib.getDocument({ 
      data: arrayBuffer,
      cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/cmaps/',
      cMapPacked: true,
      disableFontFace: true // Tối ưu RAM cho máy yếu bằng cách bỏ qua nạp font không cần thiết
    });
    
    const pdf = await loadingTask.promise;
    const totalPages = pdf.numPages;

    const images = [];

    // Render trang 1
    const firstPageImage = await renderPageToImageWorker(pdf, 1, scale, quality);
    images.push(firstPageImage);

    // Render trang cuối (nếu văn bản có nhiều hơn 1 trang)
    if (totalPages > 1) {
      const lastPageImage = await renderPageToImageWorker(pdf, totalPages, scale, quality);
      images.push(lastPageImage);
    }

    // Giải phóng tài nguyên PDF lập tức
    try {
      await pdf.cleanup();
      await pdf.destroy();
    } catch (_) {}

    self.postMessage({ id, status: 'success', images });
  } catch (err) {
    self.postMessage({ id, status: 'error', error: err.message || String(err) });
  }
};

async function renderPageToImageWorker(pdf, pageNumber, scale, quality) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('OffscreenCanvas không được hỗ trợ trong môi trường này');
  }

  const width = Math.floor(viewport.width);
  const height = Math.floor(viewport.height);

  const canvas = new OffscreenCanvas(width, height);
  // alpha: false giúp tiết kiệm 25% RAM pixel buffer canvas
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });

  const renderContext = {
    canvasContext: context,
    viewport: viewport
  };

  await page.render(renderContext).promise;

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality });
  
  // Ép giải phóng bộ nhớ RAM pixel của canvas ngay lập tức
  canvas.width = 0;
  canvas.height = 0;

  try {
    page.cleanup();
  } catch (_) {}

  const buffer = await blob.arrayBuffer();
  return arrayBufferToBase64(buffer);
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const chunkSize = 0x8000; // 32KB memory chunking
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return self.btoa(binary);
}
