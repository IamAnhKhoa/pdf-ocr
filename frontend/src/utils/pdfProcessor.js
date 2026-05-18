import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

/**
 * Đọc file PDF và trả về mảng các ảnh base64 của trang đầu và trang cuối (nếu có nhiều trang)
 */
export async function extractFirstAndLastPage(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdf.numPages;

  const images = [];

  // Lấy trang 1
  const firstPageImage = await renderPageToImage(pdf, 1);
  images.push(firstPageImage);

  // Nếu có nhiều hơn 1 trang, lấy trang cuối cùng
  if (totalPages > 1) {
    const lastPageImage = await renderPageToImage(pdf, totalPages);
    images.push(lastPageImage);
  }

  return images;
}

async function renderPageToImage(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  // Scale lớn một chút để đảm bảo OCR đọc rõ nét, scale = 2 là phù hợp
  const scale = 2;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.height = viewport.height;
  canvas.width = viewport.width;

  const renderContext = {
    canvasContext: context,
    viewport: viewport
  };

  await page.render(renderContext).promise;

  // Trả về ảnh base64 định dạng JPEG để giảm dung lượng so với PNG
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  // Loại bỏ tiền tố data:image/jpeg;base64, để gửi API cho gọn
  return dataUrl.split(',')[1];
}
