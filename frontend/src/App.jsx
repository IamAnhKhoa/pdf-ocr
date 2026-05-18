import { useState } from 'react';
import { Upload, FileText, Download, Loader2, AlertCircle } from 'lucide-react';
import * as XLSX from 'xlsx';
import { extractFirstAndLastPage } from './utils/pdfProcessor';

function App() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [dataList, setDataList] = useState([]);
  const [error, setError] = useState('');

  const handleFileUpload = async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    setProgress({ current: 0, total: files.length });
    setError('');

    try {
      for (let i = 0; i < files.length; i++) {
        setProgress({ current: i + 1, total: files.length });
        const file = files[i];
        if (file.type !== 'application/pdf') {
          setError(`File ${file.name} không phải là PDF.`);
          continue;
        }

        // 1. Trích xuất trang 1 và trang cuối thành ảnh base64
        const imagesBase64 = await extractFirstAndLastPage(file);

        // 2. Gửi API lên Backend (Cloudflare Worker)
        // Lưu ý: Đã hỗ trợ lấy URL từ biến môi trường
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8787/api/extract';
        
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ images: imagesBase64 }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Lỗi khi xử lý qua AI Server.');
        }

        const textResult = await response.text();
        
        // Cố gắng parse JSON, xử lý trường hợp AI trả về dạng markdown ```json ... ```
        let jsonData = {};
        try {
          const cleanText = textResult.replace(/```json\n?|\n?```/g, '').trim();
          jsonData = JSON.parse(cleanText);
        } catch (e) {
          console.error("Lỗi parse JSON:", textResult, e);
          throw new Error('Dữ liệu AI trả về không đúng định dạng JSON.', { cause: e });
        }

        setDataList((prev) => [...prev, jsonData]);
      }
    } catch (err) {
      console.error(err);
      setError(err.message || 'Có lỗi xảy ra trong quá trình xử lý.');
    } finally {
      setIsProcessing(false);
      setProgress({ current: 0, total: 0 });
      // Reset input để có thể chọn lại cùng 1 file
      event.target.value = '';
    }
  };

  const exportToExcel = () => {
    if (dataList.length === 0) return;

    // Chuẩn bị dữ liệu cho Excel với tên cột tiếng Việt
    const excelData = dataList.map((item, index) => ({
      'STT': index + 1,
      'SỐ ĐẾN': item.soDen || '',
      'SỐ KÝ HIỆU': item.soKyHieu || '',
      'NỘI DUNG': item.noiDung || '',
      'NGÀY VB ĐẾN': item.ngayVBDen || '',
      'THỜI HẠN GIẢI QUYẾT': item.thoiHanGiaiQuyet || '',
      'Ý KIẾN CHỈ ĐẠO': item.yKienChiDao || '',
      'TIẾN ĐỘ GIẢI QUYẾT VĂN BẢN': item.tienDoGiaiQuyet || '',
      'SỐ KÝ HIỆU VB TRẢ LỜI': item.soKyHieuVBTraLoi || ''
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "VanBan");

    // Canh chỉnh độ rộng cột
    const wscols = [
      {wch: 5}, // STT
      {wch: 10}, // SỐ ĐẾN
      {wch: 20}, // SỐ KÝ HIỆU
      {wch: 50}, // NỘI DUNG
      {wch: 15}, // NGÀY VB ĐẾN
      {wch: 20}, // THỜI HẠN GIẢI QUYẾT
      {wch: 25}, // Ý KIẾN CHỈ ĐẠO
      {wch: 25}, // TIẾN ĐỘ
      {wch: 20}, // SỐ KÝ HIỆU TRẢ LỜI
    ];
    worksheet['!cols'] = wscols;

    XLSX.writeFile(workbook, "Danh_sach_van_ban.xlsx");
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8 font-sans">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-8 text-center border border-gray-100">
          <h1 className="text-3xl font-bold text-blue-700 mb-2">Hệ Thống Trích Xuất Văn Bản PDF</h1>
          <p className="text-gray-500">Sử dụng AI để tự động đọc PDF và xuất dữ liệu ra Excel</p>
        </div>

        {/* Upload Section */}
        <div className="bg-white rounded-xl shadow-sm p-8 mb-8 text-center border border-gray-100">
          <label 
            htmlFor="file-upload" 
            className={`cursor-pointer flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-12 transition-colors ${
              isProcessing ? 'border-gray-300 bg-gray-50' : 'border-blue-400 bg-blue-50 hover:bg-blue-100'
            }`}
          >
            {isProcessing ? (
              <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
            ) : (
              <Upload className="w-12 h-12 text-blue-500 mb-4" />
            )}
            <span className="text-lg font-medium text-gray-700">
              {isProcessing 
                ? `Đang xử lý PDF và AI phân tích... (${progress.current}/${progress.total})` 
                : 'Nhấn vào đây để tải lên file PDF'}
            </span>
            <span className="text-sm text-gray-500 mt-2">Có thể chọn nhiều file cùng lúc</span>
            <input 
              id="file-upload" 
              type="file" 
              accept=".pdf" 
              multiple
              className="hidden" 
              onChange={handleFileUpload}
              disabled={isProcessing}
            />
          </label>

          {error && (
            <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-lg flex items-center justify-center gap-2">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Data Table Section */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
            <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              Dữ liệu đã trích xuất ({dataList.length})
            </h2>
            <button
              onClick={exportToExcel}
              disabled={dataList.length === 0}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                dataList.length === 0 
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed' 
                  : 'bg-green-600 hover:bg-green-700 text-white shadow-sm'
              }`}
            >
              <Download className="w-4 h-4" />
              Xuất Excel
            </button>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-gray-600">
              <thead className="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3">STT</th>
                  <th className="px-4 py-3 min-w-[100px]">Số Đến</th>
                  <th className="px-4 py-3 min-w-[150px]">Số Ký Hiệu</th>
                  <th className="px-4 py-3 min-w-[300px]">Nội Dung</th>
                  <th className="px-4 py-3 min-w-[120px]">Ngày Đến</th>
                  <th className="px-4 py-3 min-w-[150px]">Thời Hạn</th>
                  <th className="px-4 py-3 min-w-[150px]">Ý Kiến</th>
                  <th className="px-4 py-3 min-w-[150px]">Tiến Độ</th>
                  <th className="px-4 py-3 min-w-[150px]">Số Trả Lời</th>
                </tr>
              </thead>
              <tbody>
                {dataList.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="px-4 py-12 text-center text-gray-400">
                      Chưa có dữ liệu nào. Hãy tải lên file PDF.
                    </td>
                  </tr>
                ) : (
                  dataList.map((item, index) => (
                    <tr key={index} className="bg-white border-b hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{index + 1}</td>
                      <td className="px-4 py-3 font-semibold text-blue-600">{item.soDen}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{item.soKyHieu}</td>
                      <td className="px-4 py-3">{item.noiDung}</td>
                      <td className="px-4 py-3">{item.ngayVBDen}</td>
                      <td className="px-4 py-3">{item.thoiHanGiaiQuyet}</td>
                      <td className="px-4 py-3">{item.yKienChiDao}</td>
                      <td className="px-4 py-3">{item.tienDoGiaiQuyet}</td>
                      <td className="px-4 py-3">{item.soKyHieuVBTraLoi}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
