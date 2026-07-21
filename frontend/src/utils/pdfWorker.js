import * as pdfjsLib from 'pdfjs-dist';

// Thiết lập workerSrc cho PDF.js bên trong Web Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

self.onmessage = async (e) => {
  const { id, arrayBuffer } = e.data;
  if (!arrayBuffer) {
    self.postMessage({ id, status: 'error', error: 'Dữ liệu file không hợp lệ' });
    return;
  }

  try {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const totalPages = pdf.numPages;

    const images = [];

    // Render trang 1
    const firstPageImage = await renderPageToImageWorker(pdf, 1);
    images.push(firstPageImage);

    // Render trang cuối (nếu văn bản có nhiều hơn 1 trang)
    if (totalPages > 1) {
      const lastPageImage = await renderPageToImageWorker(pdf, totalPages);
      images.push(lastPageImage);
    }

    try {
      await pdf.destroy();
    } catch (_) {}

    self.postMessage({ id, status: 'success', images });
  } catch (err) {
    self.postMessage({ id, status: 'error', error: err.message || String(err) });
  }
};

async function renderPageToImageWorker(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  const scale = 2;
  const viewport = page.getViewport({ scale });

  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('OffscreenCanvas không được hỗ trợ trong môi trường này');
  }

  const canvas = new OffscreenCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
  const context = canvas.getContext('2d');

  const renderContext = {
    canvasContext: context,
    viewport: viewport
  };

  await page.render(renderContext).promise;

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
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
