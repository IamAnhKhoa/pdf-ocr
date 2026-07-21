import * as pdfjsLib from 'pdfjs-dist';

// Cấu hình workerSrc cho PDF.js khi chạy fallback ở luồng chính
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

let messageIdCounter = 0;

/**
 * Xử lý file PDF thông qua Web Worker (nếu hỗ trợ OffscreenCanvas)
 * giúp việc render 100% không ảnh hưởng đến luồng chính của Chrome.
 */
function extractWithWorker(arrayBuffer, options = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pdfWorker.js', import.meta.url), { type: 'module' });
    const id = ++messageIdCounter;

    const timeoutTimer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Web Worker render PDF bị quá thời gian (Timeout 30s)'));
    }, 30000);

    worker.onmessage = (e) => {
      if (e.data && e.data.id === id) {
        clearTimeout(timeoutTimer);
        worker.terminate();
        if (e.data.status === 'success') {
          resolve(e.data.images);
        } else {
          reject(new Error(e.data.error || 'Lỗi xử lý PDF trong Web Worker'));
        }
      }
    };

    worker.onerror = (err) => {
      clearTimeout(timeoutTimer);
      worker.terminate();
      reject(new Error(`Web Worker Lỗi: ${err.message || 'Worker crash'}`));
    };

    const scale = options.scale || 1.5;
    const quality = options.quality || 0.75;
    worker.postMessage({ id, arrayBuffer, scale, quality }, [arrayBuffer]);
  });
}

/**
 * Fallback render ở main thread với micro-yielding và dọn dẹp RAM tối đa cho máy 2GB
 */
async function extractMainThreadFallback(file, options = {}) {
  const arrayBuffer = await file.arrayBuffer();
  const scale = options.scale || 1.5;
  const quality = options.quality || 0.75;

  const pdf = await pdfjsLib.getDocument({ 
    data: arrayBuffer,
    cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/cmaps/',
    cMapPacked: true,
    disableFontFace: true
  }).promise;

  const totalPages = pdf.numPages;
  const images = [];

  // Nhường luồng cho UI phản hồi
  await new Promise((r) => setTimeout(r, 10));

  // Lấy trang 1
  const firstPageImage = await renderPageToImageMainThread(pdf, 1, scale, quality);
  images.push(firstPageImage);

  // Nếu có nhiều hơn 1 trang, lấy trang cuối cùng
  if (totalPages > 1) {
    await new Promise((r) => setTimeout(r, 10));
    const lastPageImage = await renderPageToImageMainThread(pdf, totalPages, scale, quality);
    images.push(lastPageImage);
  }

  try {
    await pdf.cleanup();
    await pdf.destroy();
  } catch (_) {}

  return images;
}

async function renderPageToImageMainThread(pdf, pageNumber, scale, quality) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  // alpha: false giúp giảm 25% dung lượng bộ nhớ RAM
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  canvas.height = Math.floor(viewport.height);
  canvas.width = Math.floor(viewport.width);

  const renderContext = {
    canvasContext: context,
    viewport: viewport
  };

  await page.render(renderContext).promise;

  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  
  // Dọn dẹp kích thước canvas lập tức để giải phóng RAM
  canvas.width = 0;
  canvas.height = 0;
  
  try {
    page.cleanup();
  } catch (_) {}

  return dataUrl.split(',')[1];
}

/**
 * Đọc file PDF và trả về mảng các ảnh base64 của trang đầu và trang cuối.
 * Tối ưu hóa bộ nhớ RAM cho máy tính cấu hình 2GB RAM.
 */
export async function extractFirstAndLastPage(file, options = {}) {
  try {
    // 1. Đọc ArrayBuffer từ file
    const arrayBuffer = await file.arrayBuffer();
    // Tạo bản sao Buffer (slice) vì Web Worker sẽ transfer ArrayBuffer
    const bufferCopy = arrayBuffer.slice(0);

    // 2. Thử chạy trong Web Worker (chạy ẩn ở background thread, không khóa UI main thread)
    return await extractWithWorker(bufferCopy, options);
  } catch (err) {
    console.warn('Web Worker PDF render thất bại, chuyển sang fallback main thread:', err.message);
    // 3. Fallback sang main thread nếu browser không hỗ trợ OffscreenCanvas
    return await extractMainThreadFallback(file, options);
  }
}
