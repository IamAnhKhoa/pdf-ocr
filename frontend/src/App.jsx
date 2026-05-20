import { useState, useEffect, Fragment } from 'react';
import ExcelJS from 'exceljs';
import { extractFirstAndLastPage } from './utils/pdfProcessor';

function App() {
  const [dataList, setDataList] = useState([]);
  const [copiedRowId, setCopiedRowId] = useState(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [error, setError] = useState('');
  const [expandedRows, setExpandedRows] = useState({});
  const [showSettings, setShowSettings] = useState(false);
  const [quotaChecking, setQuotaChecking] = useState(false);
  const [quotaResults, setQuotaResults] = useState(null);

  // Stats tab states
  const [activeTab, setActiveTab] = useState('ocr'); // 'ocr', 'stats', 'config'
  const [statsData, setStatsData] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState('');
  const [hoveredBar, setHoveredBar] = useState(null);

  const fetchStats = async () => {
    setStatsLoading(true);
    setStatsError('');
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8787/api/extract';
      const baseUrl = apiUrl.replace('/api/extract', '');
      const res = await fetch(`${baseUrl}/api/stats`);
      if (!res.ok) throw new Error(`Lỗi tải dữ liệu thống kê từ server (HTTP ${res.status})`);
      const data = await res.json();
      setStatsData(data);
    } catch (err) {
      console.error(err);
      setStatsError(err.message || 'Không thể kết nối đến cơ sở dữ liệu.');
    } finally {
      setStatsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'stats') {
      fetchStats();
    }
  }, [activeTab]);

  // Cấu hình nâng cao
  const [concurrency, setConcurrency] = useState(() => {
    const saved = localStorage.getItem('pdf_ocr_concurrency');
    return saved ? parseInt(saved, 10) : 7;
  });

  const [provider, setProvider] = useState(() => {
    return localStorage.getItem('pdf_ocr_provider') || 'gemini';
  });

  const [model, setModel] = useState(() => {
    const saved = localStorage.getItem('pdf_ocr_model');
    if (saved === 'llama-3.2-11b-vision-preview') {
      return 'meta-llama/llama-4-scout-17b-16e-instruct';
    }
    return saved || 'gemini-2.5-flash';
  });

  // Lưu cài đặt
  useEffect(() => {
    localStorage.setItem('pdf_ocr_provider', provider);
    localStorage.setItem('pdf_ocr_model', model);
    localStorage.setItem('pdf_ocr_concurrency', concurrency.toString());
  }, [provider, model, concurrency]);

  // Trạng thái xử lý tổng quan
  const isProcessing = dataList.some(item => 
    ['pending', 'processing', 'waiting_retry'].includes(item.status)
  );

  // Xử lý hàng đợi tự động chạy song song
  useEffect(() => {
    const processQueue = async () => {
      const pendingItems = dataList.filter(item => item.status === 'pending');
      const activeCount = dataList.filter(item => item.status === 'processing').length;

      if (pendingItems.length === 0 || activeCount >= concurrency) return;

      const itemsToProcess = pendingItems.slice(0, concurrency - activeCount);
      itemsToProcess.forEach(item => {
        processSingleFile(item);
      });
    };

    processQueue();
  }, [dataList, concurrency]);

  // Đọc và trích xuất từng file
  const processSingleFile = async (item) => {
    setDataList(prev => prev.map(d => d.id === item.id ? { ...d, status: 'processing', error: '' } : d));

    try {
      // 1. Trích xuất trang đầu và trang cuối thành ảnh base64
      const imagesBase64 = await extractFirstAndLastPage(item.file);

      // 2. Gửi API lên Backend proxy để xử lý xoay vòng API và fallback
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8787/api/extract';
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          images: imagesBase64,
          provider: provider,
          model: model
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Lỗi máy chủ (${response.status})`);
      }

      const textResult = await response.text();
      let jsonData = {};
      try {
        const cleanText = textResult.replace(/```json\n?|\n?```/g, '').trim();
        jsonData = JSON.parse(cleanText);
      } catch (e) {
        console.error("Lỗi parse JSON kết quả:", textResult, e);
        throw new Error('Định dạng kết quả trả về từ AI không đúng chuẩn.');
      }

      // Lưu kết quả thành công vào hàng đợi
      setDataList(prev => prev.map(d => {
        if (d.id === item.id) {
          return {
            ...d,
            status: 'completed',
            soDen: jsonData.soDen || '',
            soKyHieu: jsonData.soKyHieu || '',
            ngayVBDen: jsonData.ngayVBDen || '',
            noiDung: jsonData.noiDung || '',
            yKienChiDao: jsonData.yKienChiDao || '',
            thoiHanGiaiQuyet: jsonData.thoiHanGiaiQuyet || '',
            tienDoGiaiQuyet: jsonData.tienDoGiaiQuyet || '',
            soKyHieuVBTraLoi: jsonData.soKyHieuVBTraLoi || '',
            usedProvider: jsonData.usedProvider || '',
            usedModel: jsonData.usedModel || ''
          };
        }
        return d;
      }));

    } catch (err) {
      console.error(err);
      const nextRetryCount = item.retryCount + 1;

      if (nextRetryCount <= 3) {
        // Chuyển trạng thái sang chờ thử lại
        setDataList(prev => prev.map(d => d.id === item.id ? { 
          ...d, 
          status: 'waiting_retry', 
          retryCount: nextRetryCount,
          error: err.message 
        } : d));

        // Tự động chuyển về trạng thái 'pending' để chạy lại sau 1 phút (60 giây)
        setTimeout(() => {
          setDataList(prev => prev.map(d => (d.id === item.id && d.status === 'waiting_retry') ? { ...d, status: 'pending' } : d));
        }, 60000);
      } else {
        // Đã thử lại 3 lần nhưng đều thất bại
        setDataList(prev => prev.map(d => d.id === item.id ? { 
          ...d, 
          status: 'failed', 
          error: `${err.message} (Đã thử lại 3 lần thất bại)` 
        } : d));
      }
    }
  };

  const handleFileUpload = (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const newItems = Array.from(files)
      .filter(file => file.type === 'application/pdf')
      .map((file, index) => ({
        id: `${file.name}-${Date.now()}-${index}`,
        fileName: file.name,
        file: file,
        status: 'pending',
        retryCount: 0,
        error: '',
        soDen: '',
        soKyHieu: '',
        ngayVBDen: '',
        noiDung: '',
        yKienChiDao: '',
        thoiHanGiaiQuyet: '',
        tienDoGiaiQuyet: '',
        soKyHieuVBTraLoi: ''
      }));

    if (newItems.length === 0) {
      setError('Vui lòng chọn các file PDF hợp lệ.');
      return;
    }

    setError('');
    setDataList(prev => [...prev, ...newItems]);
    event.target.value = ''; // Reset input
  };

  const handleRetryFile = (item) => {
    setDataList(prev => prev.map(d => d.id === item.id ? { 
      ...d, 
      status: 'pending', 
      retryCount: 0, 
      error: '' 
    } : d));
  };

  const handleRemoveFile = (id) => {
    setDataList(prev => prev.filter(item => item.id !== id));
  };

  const handleClearAll = () => {
    if (window.confirm('Bạn có chắc chắn muốn xóa sạch toàn bộ danh sách hiện tại?')) {
      setDataList([]);
    }
  };

  // Cập nhật giá trị khi người dùng chỉnh sửa trực tiếp trong bảng xổ ra
  const handleUpdateField = (id, fieldName, value) => {
    setDataList(prev => prev.map(item => {
      if (item.id === id) {
        return { ...item, [fieldName]: value };
      }
      return item;
    }));
  };

  // Tự động tăng và điền cho các dòng Số Đến tiếp theo
  const handleUpdateSoDen = (index, newValue) => {
    setDataList(prev => {
      const newList = [...prev];
      if (index >= 0 && index < newList.length) {
        newList[index] = { ...newList[index], soDen: newValue };

        // Phát hiện số ở cuối chuỗi hoặc chuỗi số đơn thuần
        const match = newValue.match(/^(.*?)(\d+)([^\d]*)$/);
        if (match) {
          const prefix = match[1];
          const numStr = match[2];
          const suffix = match[3];
          const startNum = parseInt(numStr, 10);
          const numLength = numStr.length;

          for (let j = index + 1; j < newList.length; j++) {
            const nextNum = startNum + (j - index);
            const nextNumStr = String(nextNum).padStart(numLength, '0');
            newList[j] = {
              ...newList[j],
              soDen: `${prefix}${nextNumStr}${suffix}`
            };
          }
        }
      }
      return newList;
    });
  };

  // Copy một dòng sang Clipboard (Ngăn cách bằng phím Tab để dán trực tiếp vào Excel)
  const handleCopyRow = (item) => {
    const textToCopy = [
      item.soDen || '',
      item.soKyHieu || '',
      item.status === 'failed' || item.status === 'waiting_retry'
        ? `LỖI: ${item.error || 'Lỗi khi đọc file'}`
        : (item.noiDung || ''),
      item.ngayVBDen || '',
      item.thoiHanGiaiQuyet || '',
      item.yKienChiDao || '',
      item.tienDoGiaiQuyet || '',
      item.soKyHieuVBTraLoi || ''
    ].join('\t');

    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopiedRowId(item.id);
      setTimeout(() => setCopiedRowId(null), 2000);
    });
  };

  // Sao chép toàn bộ các dòng dữ liệu để dán vào Excel cùng lúc
  const handleCopyAll = () => {
    if (dataList.length === 0) return;

    const allRowsText = dataList.map(item => [
      item.soDen || '',
      item.soKyHieu || '',
      item.status === 'failed' || item.status === 'waiting_retry'
        ? `LỖI: ${item.error || 'Lỗi khi đọc file'}`
        : (item.noiDung || ''),
      item.ngayVBDen || '',
      item.thoiHanGiaiQuyet || '',
      item.yKienChiDao || '',
      item.tienDoGiaiQuyet || '',
      item.soKyHieuVBTraLoi || ''
    ].join('\t')).join('\n');

    navigator.clipboard.writeText(allRowsText).then(() => {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    });
  };

  // Xuất Excel định dạng Times New Roman, Size 14, viền ô đầy đủ bằng ExcelJS
  const exportToExcel = async () => {
    if (dataList.length === 0) return;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('VanBan');

    // Cấu hình các cột (Tên cột đã sửa từ "SỐ KÝ HỆ" thành "SỐ KÝ HIỆU")
    worksheet.columns = [
      { header: 'STT', key: 'stt', width: 8 },
      { header: 'SỐ ĐẾN', key: 'soDen', width: 12 },
      { header: 'SỐ KÝ HIỆU', key: 'soKyHieu', width: 22 },
      { header: 'NỘI DUNG', key: 'noiDung', width: 55 },
      { header: 'NGÀY VB ĐẾN', key: 'ngayVBDen', width: 18 },
      { header: 'THỜI HẠN GIẢI QUYẾT', key: 'thoiHanGiaiQuyet', width: 22 },
      { header: 'Ý KIẾN CHỈ ĐẠO', key: 'yKienChiDao', width: 28 },
      { header: 'TIẾN ĐỘ GIẢI QUYẾT VĂN BẢN', key: 'tienDoGiaiQuyet', width: 28 },
      { header: 'SỐ KÝ HIỆU VB TRẢ LỜI', key: 'soKyHieuVBTraLoi', width: 22 }
    ];

    // Thêm các dòng dữ liệu vào file
    dataList.forEach((item, index) => {
      worksheet.addRow({
        stt: index + 1,
        soDen: item.soDen || '',
        soKyHieu: item.soKyHieu || '',
        noiDung: item.noiDung || '',
        ngayVBDen: item.ngayVBDen || '',
        thoiHanGiaiQuyet: item.thoiHanGiaiQuyet || '',
        yKienChiDao: item.yKienChiDao || '',
        tienDoGiaiQuyet: item.tienDoGiaiQuyet || (item.status === 'processing' ? 'Đang đọc' : item.status === 'completed' ? 'Thành công' : 'Chờ xử lý'),
        soKyHieuVBTraLoi: item.soKyHieuVBTraLoi || ''
      });
    });

    // Định dạng toàn bộ dòng (Times New Roman, Size 14, Căn chỉnh và kẻ viền chi tiết)
    worksheet.eachRow({ includeHeader: true }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        // Cấu hình font chữ: Times New Roman, Cỡ 14, In đậm dòng tiêu đề đầu tiên
        cell.font = {
          name: 'Times New Roman',
          size: 14,
          bold: rowNumber === 1
        };

        // Căn giữa cột STT
        if (cell.col === 1) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
          cell.alignment = { vertical: 'middle', wrapText: true };
        }

        // Định dạng đường viền (Border) cho tất cả ô
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFB0B0B0' } },
          left: { style: 'thin', color: { argb: 'FFB0B0B0' } },
          bottom: { style: 'thin', color: { argb: 'FFB0B0B0' } },
          right: { style: 'thin', color: { argb: 'FFB0B0B0' } }
        };
      });

      // Điều chỉnh chiều cao dòng để dễ nhìn
      row.height = rowNumber === 1 ? 30 : 25;
    });

    // Xuất file và tải về dưới dạng XLSX chuẩn
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'Danh_sach_van_ban_OCR.xlsx';
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  const toggleRow = (id) => {
    setExpandedRows(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const stats = {
    total: dataList.length,
    pending: dataList.filter(d => d.status === 'pending').length,
    processing: dataList.filter(d => d.status === 'processing' || d.status === 'waiting_retry').length,
    completed: dataList.filter(d => d.status === 'completed').length,
    failed: dataList.filter(d => d.status === 'failed').length
  };

  // Danh sách các luồng đang chạy để hiển thị tiến trình
  const activeItems = dataList.filter(d => d.status === 'processing');
  const waitingItems = dataList.filter(d => d.status === 'waiting_retry');

  const PROVIDER_LABELS = { gemini: 'Gemini', openrouter: 'OpenRouter', groq: 'Groq' };
  const PROVIDER_COLORS = {
    gemini: 'bg-blue-50 text-blue-700 border-blue-200',
    openrouter: 'bg-violet-50 text-violet-700 border-violet-200',
    groq: 'bg-orange-50 text-orange-700 border-orange-200',
    '': 'bg-slate-50 text-slate-600 border-slate-200'
  };

  return (
    <div className="min-h-screen bg-slate-50/50 text-slate-800 p-4 md:p-8 font-sans transition-all">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header Section (Thiết kế phong cách CRM trắng đẹp, hiện đại 2026) */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-center gap-4 text-left">
            {/* Biểu tượng tệp tin thiết kế phẳng sang trọng */}
            <div className="w-12 h-12 bg-blue-600/10 text-blue-600 rounded-xl flex items-center justify-center shrink-0 font-bold text-xl">
              📄
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight leading-tight">
                Hệ Thống Trích Xuất Văn Bản PDF
              </h1>
              <p className="text-slate-500 text-xs md:text-sm mt-0.5 font-medium">
                Ứng dụng AI phân tích số hóa hồ sơ công văn văn thư hành chính
              </p>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
            {/* Tab Menu Navigation (Premium Pill style) */}
            <div className="flex border border-slate-200/60 bg-slate-50 p-1 rounded-xl shadow-xs">
              {[
                { id: 'ocr', label: '📄 Trích Xuất' },
                { id: 'stats', label: '📊 Thống Kê' },
                { id: 'config', label: '⚙️ Cấu Hình' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  id={`tab-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-2 px-3 md:px-4 rounded-lg text-xs md:text-sm font-extrabold transition-all text-center whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/50'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <button
              id="btn-export-excel"
              onClick={exportToExcel}
              disabled={dataList.length === 0}
              className={`flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs md:text-sm transition-all shadow-sm ${
                dataList.length === 0 
                  ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed' 
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-600'
              }`}
            >
              📥 Xuất Excel
            </button>
          </div>
        </div>

        {/* OCR TAB */}
        {activeTab === 'ocr' && (
          <>
            {/* Upload Zone (Phong cách CRM phẳng, tinh tế) */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
              <label 
                htmlFor="file-upload" 
                className={`cursor-pointer flex flex-col md:flex-row items-center justify-between gap-4 p-5 md:p-6 border border-dashed border-slate-200 bg-slate-50/20 rounded-xl hover:bg-slate-50/50 hover:border-slate-300 transition-colors ${
                  isProcessing ? 'opacity-85 pointer-events-none' : ''
                }`}
              >
                <div className="flex items-center gap-4 text-left">
                  {/* Đám mây phong cách CRM tối giản */}
                  <div className="w-10 h-10 bg-blue-600/10 text-blue-600 rounded-full flex items-center justify-center shrink-0 text-lg">
                    ☁️
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-sm md:text-base leading-snug">
                      {isProcessing ? `Đang tự động đọc ${stats.processing} file PDF cùng lúc...` : 'Kéo & thả PDF vào đây'}
                    </h3>
                    <p className="text-slate-500 text-xs mt-0.5 font-normal">
                      Chọn nhiều file cùng lúc để tự động xử lý hàng loạt song song
                    </p>
                  </div>
                </div>
                
                <div className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-sm transition-colors shadow-sm shrink-0">
                  Chọn File
                </div>

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
                <div className="mt-3 p-2.5 bg-rose-50 border border-rose-100 text-rose-800 rounded-lg text-xs font-semibold text-center">
                  Lỗi: {error}
                </div>
              )}
            </div>

            {/* Queue Stats Bar */}
            {dataList.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm space-y-3">
                {/* Thống kê tổng */}
                <div className="flex flex-wrap justify-between items-center gap-3 text-xs md:text-sm">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-1 font-semibold text-slate-500">
                    <span>Tổng: <strong className="text-slate-900">{stats.total}</strong></span>
                    <span>Đang chạy: <strong className="text-blue-600">{stats.processing}</strong></span>
                    <span>Thành công: <strong className="text-emerald-700">{stats.completed}</strong></span>
                    {stats.failed > 0 && <span>Thất bại: <strong className="text-rose-700">{stats.failed}</strong></span>}
                    {stats.pending > 0 && <span>Chờ: <strong className="text-slate-500">{stats.pending}</strong></span>}
                  </div>
                  <button
                    id="btn-clear-list"
                    onClick={handleClearAll}
                    className="text-xs text-rose-700 hover:underline font-bold transition-colors shrink-0"
                  >
                    Xóa sạch danh sách
                  </button>
                </div>

                {/* Tiến trình luồng đang chạy */}
                {(activeItems.length > 0 || waitingItems.length > 0) && (
                  <div className="border-t border-slate-100 pt-2.5">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Luồng đang xử lý</p>
                    <div className="flex flex-wrap gap-2">
                      {activeItems.map(item => (
                        <div
                          key={item.id}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold bg-blue-50 border-blue-200 text-blue-700"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shrink-0"></span>
                          <span className="max-w-[140px] truncate" title={item.fileName}>{item.fileName.replace(/\.pdf$/i, '')}</span>
                          <span className="text-blue-400 font-normal">· AI đang đọc...</span>
                        </div>
                      ))}
                      {waitingItems.map(item => (
                        <div
                          key={item.id}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold bg-amber-50 border-amber-200 text-amber-700"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0"></span>
                          <span className="max-w-[140px] truncate" title={item.fileName}>{item.fileName.replace(/\.pdf$/i, '')}</span>
                          <span className="text-amber-400 font-normal">· chờ thử lại {item.retryCount}/3</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Hiển thị model đã dùng cho các file hoàn thành gần đây */}
                {dataList.some(d => d.status === 'completed' && d.usedProvider) && (
                  <div className="border-t border-slate-100 pt-2.5">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Mô hình đã sử dụng</p>
                    <div className="flex flex-wrap gap-1.5">
                      {['gemini', 'openrouter', 'groq'].map(prov => {
                        const count = dataList.filter(d => d.usedProvider === prov).length;
                        if (count === 0) return null;
                        return (
                          <span key={prov} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${PROVIDER_COLORS[prov]}`}>
                            {PROVIDER_LABELS[prov]}
                            <span className="font-bold">×{count}</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Data Table Section (Bảng kết quả phẳng CRM 2026 sang trọng) */}
            <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white">
                <h2 className="text-sm md:text-base font-bold text-slate-900 tracking-tight">
                  Danh sách kết quả trích xuất ({dataList.length} văn bản)
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  {dataList.length > 0 && (
                    <button
                      id="btn-copy-all"
                      onClick={handleCopyAll}
                      className={`px-4 py-1.5 rounded-lg text-xs md:text-sm font-bold border transition-colors ${
                        copiedAll 
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                          : 'bg-white hover:bg-slate-50 text-slate-500 border-slate-200 shadow-sm'
                      }`}
                    >
                      {copiedAll ? 'Đã copy toàn bộ!' : '📋 Copy toàn bộ kết quả'}
                    </button>
                  )}
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-sm md:text-base text-left text-slate-700 border-collapse">
                  <thead className="text-[11px] md:text-xs text-slate-500 uppercase bg-slate-50/50 border-b border-slate-100 font-bold tracking-wider">
                    <tr>
                      <th className="px-3 py-3 w-16 text-center">STT</th>
                      <th className="px-3 py-3 min-w-[90px]">Số Đến</th>
                      <th className="px-3 py-3 min-w-[130px]">Số Ký Hiệu</th>
                      <th className="px-3 py-3 min-w-[280px]">Nội Dung</th>
                      <th className="px-3 py-3 min-w-[110px]">Ngày Đến</th>
                      <th className="px-3 py-3 min-w-[110px]">Thời Hạn</th>
                      <th className="px-3 py-3 min-w-[160px]">Ý Kiến</th>
                      <th className="px-3 py-3 min-w-[120px]">Tiến Độ</th>
                      <th className="px-3 py-3 min-w-[120px]">VB Trả Lời</th>
                      <th className="px-3 py-3 w-12 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {dataList.length === 0 ? (
                      <tr>
                        <td colSpan="10" className="px-4 py-16 text-center text-slate-400 font-medium text-sm md:text-base">
                          Chưa có văn bản nào trong hàng đợi. Nhấp vào nút "Chọn File" ở trên để bắt đầu.
                        </td>
                      </tr>
                    ) : (
                      dataList.map((item, index) => {
                        const isProcessingRow = item.status === 'processing';
                        const isPending = item.status === 'pending';
                        const isCompleted = item.status === 'completed';
                        const isRetrying = item.status === 'waiting_retry';
                        const isFailed = item.status === 'failed';

                        const isExpanded = !!expandedRows[item.id];

                        return (
                          <Fragment key={item.id}>
                            <tr 
                              className={`transition-all duration-300 hover:bg-slate-50/50 slide-in ${
                                isExpanded ? 'bg-slate-50/30 border-l-4 border-l-blue-600' : ''
                              } ${
                                isProcessingRow ? 'breathe' : ''
                              } ${
                                isCompleted ? 'pop-in' : ''
                              }`}
                            >
                              {/* STT Column */}
                              <td className="px-3 py-2 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  <button 
                                    onClick={() => toggleRow(item.id)}
                                    className={`w-5 h-5 rounded font-extrabold text-[10px] flex items-center justify-center border transition-colors shrink-0 ${
                                      isExpanded 
                                        ? 'bg-slate-800 text-white border-slate-800' 
                                        : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200 shadow-sm'
                                    }`}
                                  >
                                    {isExpanded ? '−' : '+'}
                                  </button>
                                  <span className="text-slate-500 font-bold text-sm w-4 text-center">{index + 1}</span>
                                </div>
                              </td>

                              {/* SỐ ĐẾN */}
                              <td className="px-2 py-1.5">
                                {isProcessingRow ? (
                                  <div className="skeleton h-6 w-14 mx-1" />
                                ) : (
                                  <input 
                                    type="text" 
                                    value={item.soDen || ''} 
                                    onChange={(e) => handleUpdateSoDen(index, e.target.value)}
                                    className="w-full bg-transparent hover:bg-slate-50 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded border-0 px-2 py-1 text-slate-900 font-bold text-[14px] outline-none transition-all"
                                    placeholder="..."
                                  />
                                )}
                              </td>

                              {/* SỐ KÝ HIỆU */}
                              <td className="px-2 py-1.5">
                                {isProcessingRow ? (
                                  <div className="skeleton h-6 w-24 mx-1" />
                                ) : (
                                  <input 
                                    type="text" 
                                    value={item.soKyHieu || ''} 
                                    onChange={(e) => handleUpdateField(item.id, 'soKyHieu', e.target.value)}
                                    className="w-full bg-transparent hover:bg-slate-50 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded border-0 px-2 py-1 text-slate-900 font-bold text-[14px] outline-none transition-all"
                                    placeholder="..."
                                  />
                                )}
                              </td>

                              {/* NỘI DUNG */}
                              <td className="px-2 py-1.5">
                                {isProcessingRow ? (
                                  <div className="space-y-1.5 py-1 px-1">
                                    <div className="skeleton h-3.5 w-full" />
                                    <div className="skeleton h-3.5 w-4/5" />
                                  </div>
                                ) : (
                                  <textarea
                                    rows={2}
                                    value={item.noiDung || ''} 
                                    onChange={(e) => handleUpdateField(item.id, 'noiDung', e.target.value)}
                                    className="w-full bg-transparent hover:bg-slate-50 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded border-0 px-2 py-1 text-slate-800 text-[14px] outline-none transition-all resize-y leading-relaxed font-normal min-h-[44px]"
                                    placeholder="..."
                                  />
                                )}
                              </td>

                              {/* NGÀY ĐẾN */}
                              <td className="px-2 py-1.5">
                                {isProcessingRow ? (
                                  <div className="skeleton h-6 w-20 mx-1" />
                                ) : (
                                  <input 
                                    type="text" 
                                    value={item.ngayVBDen || ''} 
                                    onChange={(e) => handleUpdateField(item.id, 'ngayVBDen', e.target.value)}
                                    className="w-full bg-transparent hover:bg-slate-50 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded border-0 px-2 py-1 text-slate-800 text-[14px] outline-none transition-all"
                                    placeholder="..."
                                  />
                                )}
                              </td>

                              {/* THỜI HẠN */}
                              <td className="px-2 py-1.5">
                                <input 
                                  type="text" 
                                  value={item.thoiHanGiaiQuyet || ''} 
                                  onChange={(e) => handleUpdateField(item.id, 'thoiHanGiaiQuyet', e.target.value)}
                                  className="w-full bg-transparent hover:bg-slate-50 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded border-0 px-2 py-1 text-slate-800 text-[14px] outline-none transition-all"
                                  placeholder="..."
                                />
                              </td>

                              {/* Ý KIẾN */}
                              <td className="px-2 py-1.5">
                                <textarea
                                  rows={2}
                                  value={item.yKienChiDao || ''} 
                                  onChange={(e) => handleUpdateField(item.id, 'yKienChiDao', e.target.value)}
                                  className="w-full bg-transparent hover:bg-slate-50 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded border-0 px-2 py-1 text-slate-800 text-[14px] outline-none transition-all resize-y leading-relaxed font-normal min-h-[44px]"
                                  placeholder="..."
                                />
                              </td>

                              {/* TIẾN ĐỘ */}
                              <td className="px-2 py-1.5">
                                <input 
                                  type="text" 
                                  value={item.tienDoGiaiQuyet || ''} 
                                  onChange={(e) => handleUpdateField(item.id, 'tienDoGiaiQuyet', e.target.value)}
                                  className="w-full bg-transparent hover:bg-slate-50 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded border-0 px-2 py-1 text-slate-800 text-[14px] outline-none transition-all"
                                  placeholder="..."
                                />
                              </td>

                              {/* VB TRẢ LỜI */}
                              <td className="px-2 py-1.5">
                                <input 
                                  type="text" 
                                  value={item.soKyHieuVBTraLoi || ''} 
                                  onChange={(e) => handleUpdateField(item.id, 'soKyHieuVBTraLoi', e.target.value)}
                                  className="w-full bg-transparent hover:bg-slate-50 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded border-0 px-2 py-1 text-slate-800 text-[14px] outline-none transition-all"
                                  placeholder="..."
                                />
                              </td>

                              {/* Delete Action Column */}
                              <td className="px-3 py-2 text-center">
                                <button
                                  onClick={() => handleRemoveFile(item.id)}
                                  className="w-8 h-8 rounded-lg hover:bg-rose-50 text-rose-600 flex items-center justify-center transition-colors font-bold text-base"
                                  title="Xóa dòng này"
                                >
                                  🗑️
                                </button>
                              </td>
                            </tr>

                            {isExpanded && (
                              <tr className="bg-slate-50/50">
                                <td colSpan="10" className="px-6 py-4 border-t border-b border-slate-100">
                                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 text-sm">
                                    <div className="space-y-1">
                                      <span className="text-slate-400 font-bold text-[10px] uppercase block tracking-wider">Tên file PDF</span>
                                      <span className="text-slate-700 font-bold break-all text-sm">{item.fileName}</span>
                                    </div>
                                    <div className="space-y-1">
                                      <span className="text-slate-400 font-bold text-[10px] uppercase block tracking-wider">Trạng thái đọc OCR</span>
                                      <div className="flex items-center gap-2">
                                        {isProcessingRow && <span className="font-semibold text-blue-600">Đang đọc <span className="dot-bounce text-blue-500"><span/><span/><span/></span></span>}
                                        {isPending && <span className="font-semibold text-slate-500">Chờ xử lý</span>}
                                        {isCompleted && <span className="font-semibold text-emerald-600">✔ Thành công</span>}
                                        {isRetrying && <span className="font-semibold text-amber-600">Thử lại {item.retryCount}/3</span>}
                                        {isFailed && <span className="font-semibold text-rose-600">✗ Thất bại</span>}
                                        {isFailed && (
                                          <span className="text-rose-700 text-xs font-semibold">({item.error || 'Lỗi kết nối'})</span>
                                        )}
                                        {isRetrying && (
                                          <span className="text-amber-700 text-xs font-semibold animate-pulse">(Tự động kết nối lại...)</span>
                                        )}
                                      </div>
                                      {isProcessingRow && (
                                        <div className="progress-bar-track mt-2" style={{width: 180}}>
                                          <div className="progress-bar-thumb" />
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                                      <button
                                        onClick={() => handleCopyRow(item)}
                                        className={`px-3 py-1.5 rounded-lg border font-bold text-xs transition-colors shadow-sm ${
                                          copiedRowId === item.id
                                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                            : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                                        }`}
                                      >
                                        {copiedRowId === item.id ? 'Đã copy!' : '📋 Copy Dòng'}
                                      </button>
                                      {(item.status === 'failed' || item.status === 'waiting_retry') && (
                                        <button
                                          onClick={() => handleRetryFile(item)}
                                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold transition-colors shadow-sm"
                                        >
                                          🔄 Thử lại
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* STATS TAB */}
        {activeTab === 'stats' && (
          <div className="space-y-6 fade-in">
            {/* Stats summary cards */}
            {statsLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm space-y-3 breathe">
                    <div className="w-8 h-8 bg-slate-100 rounded-lg animate-pulse" />
                    <div className="h-4 bg-slate-100 rounded w-1/2 animate-pulse" />
                    <div className="h-6 bg-slate-100 rounded w-3/4 animate-pulse" />
                  </div>
                ))}
              </div>
            ) : statsError ? (
              <div className="bg-rose-50 border border-rose-100 text-rose-800 rounded-2xl p-6 text-center shadow-xs">
                <span className="text-2xl mb-2 block">⚠️</span>
                <p className="font-bold text-sm mb-3">Không thể tải dữ liệu thống kê từ hệ thống</p>
                <p className="text-xs text-rose-600 mb-4">{statsError}</p>
                <button
                  id="btn-refresh-stats"
                  onClick={fetchStats}
                  className="px-4 py-2 bg-rose-600 text-white rounded-lg font-bold text-xs hover:bg-rose-700 transition-colors shadow-sm"
                >
                  🔄 Tải lại dữ liệu
                </button>
              </div>
            ) : !statsData || statsData.summary.total === 0 ? (
              <div className="bg-white border border-slate-100 rounded-2xl p-16 text-center shadow-sm">
                <span className="text-4xl mb-4 block">📊</span>
                <p className="font-bold text-slate-700 text-base mb-1">Chưa có dữ liệu thống kê</p>
                <p className="text-xs text-slate-405 max-w-sm mx-auto leading-relaxed">
                  Hệ thống chưa ghi nhận bất kỳ lượt trích xuất tài liệu nào. Hãy bắt đầu tải file lên để lưu dữ liệu thống kê.
                </p>
              </div>
            ) : (
              <>
                {/* 4 Cards Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {/* Card 1: Tổng cộng */}
                  <div className="bg-gradient-to-br from-blue-50 to-indigo-50/50 rounded-2xl border border-blue-100/70 p-5 shadow-xs hover:shadow-sm hover:scale-[1.01] transition-all">
                    <div className="w-10 h-10 bg-blue-600/10 text-blue-600 rounded-xl flex items-center justify-center font-bold text-lg mb-3">
                      📂
                    </div>
                    <span className="text-xs text-blue-800/70 font-bold block uppercase tracking-wider">Tổng file xử lý</span>
                    <span className="text-2xl md:text-3xl font-extrabold text-blue-900 mt-1 block">{statsData.summary.total}</span>
                    <span className="text-[10px] text-blue-600 font-semibold mt-1 block">Tất cả các phiên làm việc</span>
                  </div>

                  {/* Card 2: Thành công */}
                  <div className="bg-gradient-to-br from-emerald-50 to-teal-50/50 rounded-2xl border border-emerald-100/70 p-5 shadow-xs hover:shadow-sm hover:scale-[1.01] transition-all">
                    <div className="w-10 h-10 bg-emerald-600/10 text-emerald-600 rounded-xl flex items-center justify-center font-bold text-lg mb-3">
                      ✅
                    </div>
                    <span className="text-xs text-emerald-800/70 font-bold block uppercase tracking-wider">Trích xuất thành công</span>
                    <span className="text-2xl md:text-3xl font-extrabold text-emerald-900 mt-1 block">{statsData.summary.success}</span>
                    <span className="text-[10px] text-emerald-600 font-semibold mt-1 block">Lưu trữ đầy đủ dữ liệu</span>
                  </div>

                  {/* Card 3: Thất bại */}
                  <div className="bg-gradient-to-br from-rose-50 to-orange-50/50 rounded-2xl border border-rose-100/70 p-5 shadow-xs hover:shadow-sm hover:scale-[1.01] transition-all">
                    <div className="w-10 h-10 bg-rose-600/10 text-rose-600 rounded-xl flex items-center justify-center font-bold text-lg mb-3">
                      ❌
                    </div>
                    <span className="text-xs text-rose-800/70 font-bold block uppercase tracking-wider">Trích xuất thất bại</span>
                    <span className="text-2xl md:text-3xl font-extrabold text-rose-900 mt-1 block">{statsData.summary.failed}</span>
                    <span className="text-[10px] text-rose-600 font-semibold mt-1 block">Bị lỗi API / Quota limit</span>
                  </div>

                  {/* Card 4: Tỉ lệ */}
                  <div className="bg-gradient-to-br from-amber-50 to-yellow-50/50 rounded-2xl border border-amber-100/70 p-5 shadow-xs hover:shadow-sm hover:scale-[1.01] transition-all">
                    <div className="w-10 h-10 bg-amber-600/10 text-amber-600 rounded-xl flex items-center justify-center font-bold text-lg mb-3">
                      🎯
                    </div>
                    <span className="text-xs text-amber-800/70 font-bold block uppercase tracking-wider">Tỷ lệ thành công</span>
                    <span className="text-2xl md:text-3xl font-extrabold text-amber-900 mt-1 block">
                      {(statsData.summary.total > 0 ? (statsData.summary.success / statsData.summary.total * 100) : 0).toFixed(1)}%
                    </span>
                    <span className="text-[10px] text-amber-600 font-semibold mt-1 block">Hiệu suất trích xuất AI</span>
                  </div>
                </div>

                {/* SVG Graph Section */}
                {statsData.daily && statsData.daily.length > 0 && (
                  <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
                    <h3 className="text-sm font-bold text-slate-800 mb-6 flex items-center gap-2">
                      📈 Biểu đồ xu hướng xử lý file hàng ngày
                    </h3>
                    
                    <div className="relative w-full overflow-x-auto pb-2">
                      <div className="min-w-[650px] h-[260px] relative">
                        {/* Render SVG chart */}
                        {(() => {
                          const dailyData = statsData.daily;
                          const maxVal = Math.max(...dailyData.map(d => d.total), 5);
                          const svgWidth = 720;
                          const svgHeight = 200;
                          const paddingLeft = 40;
                          const paddingRight = 20;
                          const paddingTop = 20;
                          const paddingBottom = 30;

                          const graphWidth = svgWidth - paddingLeft - paddingRight;
                          const graphHeight = svgHeight - paddingTop - paddingBottom;

                          const colWidth = graphWidth / dailyData.length;
                          const barWidth = Math.min(colWidth * 0.5, 36);
                          
                          return (
                            <svg width="100%" height="100%" viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="overflow-visible">
                              <defs>
                                <linearGradient id="barGradSuccess" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#10b981"/>
                                  <stop offset="100%" stopColor="#059669" stopOpacity="0.8"/>
                                </linearGradient>
                                <linearGradient id="barGradFailed" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#f43f5e"/>
                                  <stop offset="100%" stopColor="#e11d48" stopOpacity="0.8"/>
                                </linearGradient>
                              </defs>

                              {/* Grid lines */}
                              {[0, 0.25, 0.5, 0.75, 1].map((ratio, index) => {
                                const yPos = paddingTop + graphHeight * (1 - ratio);
                                const gridVal = Math.round(maxVal * ratio);
                                return (
                                  <g key={index}>
                                    <line
                                      x1={paddingLeft}
                                      y1={yPos}
                                      x2={svgWidth - paddingRight}
                                      y2={yPos}
                                      stroke="#f1f5f9"
                                      strokeWidth="1.5"
                                      strokeDasharray={index === 0 ? "0" : "4 4"}
                                    />
                                    <text
                                      x={paddingLeft - 8}
                                      y={yPos + 4}
                                      textAnchor="end"
                                      className="fill-slate-400 font-bold text-[9px] font-mono"
                                    >
                                      {gridVal}
                                    </text>
                                  </g>
                                );
                              })}

                              {/* Bars rendering */}
                              {dailyData.map((d, i) => {
                                const xPos = paddingLeft + i * colWidth + (colWidth - barWidth) / 2;
                                
                                // Chiều cao tương ứng thành công và thất bại
                                const successHeight = (d.success / maxVal) * graphHeight;
                                const failedHeight = (d.failed / maxVal) * graphHeight;
                                
                                const ySuccess = paddingTop + graphHeight - successHeight;
                                const yFailed = ySuccess - failedHeight;

                                // Format date YYYY-MM-DD -> DD/MM
                                const parts = d.date.split('-');
                                const dateLabel = parts.length === 3 ? `${parts[2]}/${parts[1]}` : d.date;

                                const isHovered = hoveredBar === i;

                                return (
                                  <g 
                                    key={i}
                                    onMouseEnter={() => setHoveredBar(i)}
                                    onMouseLeave={() => setHoveredBar(null)}
                                    className="cursor-pointer group"
                                  >
                                    {/* Success bar */}
                                    {d.success > 0 && (
                                      <rect
                                        x={xPos}
                                        y={ySuccess}
                                        width={barWidth}
                                        height={successHeight}
                                        fill="url(#barGradSuccess)"
                                        rx={d.failed === 0 ? 4 : 0}
                                        className="transition-all duration-300"
                                      />
                                    )}

                                    {/* Failed bar */}
                                    {d.failed > 0 && (
                                      <rect
                                        x={xPos}
                                        y={yFailed}
                                        width={barWidth}
                                        height={failedHeight}
                                        fill="url(#barGradFailed)"
                                        rx={4}
                                        className="transition-all duration-300"
                                      />
                                    )}

                                    {/* Transparent rectangle for easy hover detection */}
                                    <rect
                                      x={paddingLeft + i * colWidth}
                                      y={paddingTop}
                                      width={colWidth}
                                      height={graphHeight}
                                      fill="transparent"
                                    />

                                    {/* X Axis Label */}
                                    <text
                                      x={xPos + barWidth / 2}
                                      y={paddingTop + graphHeight + 16}
                                      textAnchor="middle"
                                      className={`font-bold text-[10px] transition-colors ${
                                        isHovered ? 'fill-blue-600' : 'fill-slate-400'
                                      }`}
                                    >
                                      {dateLabel}
                                    </text>

                                    {/* Interactive Tooltip inside SVG */}
                                    {isHovered && (
                                      <g>
                                        <rect
                                          x={Math.max(xPos + barWidth / 2 - 60, 5)}
                                          y={Math.max(yFailed - 55, 2)}
                                          width="120"
                                          height="45"
                                          rx="6"
                                          fill="#0f172a"
                                          className="opacity-95 shadow-md"
                                        />
                                        <text
                                          x={Math.max(xPos + barWidth / 2, 65)}
                                          y={Math.max(yFailed - 40, 17)}
                                          textAnchor="middle"
                                          fill="#ffffff"
                                          className="font-bold text-[9px]"
                                        >
                                          Ngày: {d.date}
                                        </text>
                                        <text
                                          x={Math.max(xPos + barWidth / 2, 65)}
                                          y={Math.max(yFailed - 28, 29)}
                                          textAnchor="middle"
                                          fill="#a7f3d0"
                                          className="font-bold text-[9px]"
                                        >
                                          Thành công: {d.success} | Lỗi: {d.failed}
                                        </text>
                                      </g>
                                    )}
                                  </g>
                                );
                              })}
                            </svg>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                )}

                {/* Detailed Logs Table */}
                <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white">
                    <h3 className="text-sm font-bold text-slate-900">
                      Chi tiết lưu trữ thống kê theo ngày
                    </h3>
                    <span className="text-slate-400 text-xs font-bold">Dữ liệu thời gian thực</span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead className="bg-slate-50/50 text-[11px] text-slate-500 uppercase font-bold tracking-wider border-b border-slate-100">
                        <tr>
                          <th className="px-6 py-3">Ngày làm việc</th>
                          <th className="px-6 py-3">Tổng số file</th>
                          <th className="px-6 py-3">Thành công</th>
                          <th className="px-6 py-3">Thất bại</th>
                          <th className="px-6 py-3">Tỉ lệ thành công</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
                        {[...statsData.daily].reverse().map((d, index) => {
                          const rate = d.total > 0 ? ((d.success / d.total) * 100).toFixed(1) : 0;
                          
                          // Format YYYY-MM-DD -> DD/MM/YYYY
                          const parts = d.date.split('-');
                          const formattedDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : d.date;

                          return (
                            <tr key={index} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-6 py-3 font-bold text-slate-800">{formattedDate}</td>
                              <td className="px-6 py-3 font-semibold text-slate-600">{d.total}</td>
                              <td className="px-6 py-3 text-emerald-600 font-bold">{d.success}</td>
                              <td className="px-6 py-3 text-rose-600 font-semibold">{d.failed}</td>
                              <td className="px-6 py-3">
                                <span className={`px-2 py-0.5 rounded-md font-bold text-xs ${
                                  rate >= 90 
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                                    : rate >= 70 
                                    ? 'bg-amber-50 text-amber-700 border border-amber-200' 
                                    : 'bg-rose-50 text-rose-700 border border-rose-200'
                                }`}>
                                  {rate}%
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* CONFIG TAB */}
        {activeTab === 'config' && (
          <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-6 shadow-sm fade-in">
            <div>
              <h3 className="text-base font-bold text-slate-900 tracking-tight">
                Tham số cấu hình nâng cao dịch vụ
              </h3>
              <p className="text-slate-405 text-xs mt-0.5 font-normal">
                Tùy chỉnh luồng chạy song song và kênh kết nối AI nhận dạng tài liệu
              </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 border-b border-slate-100 pb-6">
              {/* Concurrency Limit */}
              <div className="space-y-2 col-span-1">
                <label className="block text-xs font-bold text-slate-700 flex justify-between">
                  <span>Số luồng chạy đồng thời:</span>
                  <span className="text-blue-600 font-extrabold">{concurrency} luồng</span>
                </label>
                <div className="flex items-center gap-3 bg-slate-50/50 border border-slate-200 rounded-xl px-4 py-3">
                  <input
                    id="input-concurrency"
                    type="range"
                    min="1"
                    max="10"
                    value={concurrency}
                    onChange={(e) => setConcurrency(parseInt(e.target.value, 10))}
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                </div>
                <span className="text-[10px] text-slate-400 block leading-snug">
                  Số lượng file PDF sẽ được gửi đồng thời lên máy chủ AI. Khuyên dùng 5-7 luồng.
                </span>
              </div>

              {/* Provider Selection */}
              <div className="space-y-2 col-span-2">
                <label className="block text-xs font-bold text-slate-700">Chọn kênh kết nối API (Dự phòng thông minh):</label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { value: 'gemini', label: 'Google Gemini (Chính)', desc: 'Nhanh & Free' },
                    { value: 'openrouter', label: 'OpenRouter (Phụ)', desc: 'Dự phòng' },
                    { value: 'groq', label: 'Groq Cloud (Kèm theo)', desc: 'Tốc độ cực cao' }
                  ].map((p) => (
                    <button
                      key={p.value}
                      id={`provider-${p.value}`}
                      onClick={() => {
                        setProvider(p.value);
                        if (p.value === 'gemini') setModel('gemini-2.5-flash');
                        else if (p.value === 'openrouter') setModel('google/gemini-2.5-flash:free');
                        else setModel('meta-llama/llama-4-scout-17b-16e-instruct');
                      }}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        provider === p.value
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                          : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-700'
                      }`}
                    >
                      <div className="font-bold text-xs md:text-sm">{p.label}</div>
                      <div className={`text-[10px] mt-0.5 font-medium ${provider === p.value ? 'text-blue-100' : 'text-slate-400'}`}>
                        {p.desc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Quota Checker */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-bold text-slate-800 text-xs block">Kiểm tra hạn mức API (Quota):</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Xác thực trạng thái hoạt động của các API Key trong hệ thống</span>
                </div>
                <button
                  id="btn-check-quota"
                  onClick={async () => {
                    setQuotaChecking(true);
                    setQuotaResults(null);
                    try {
                      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8787/api/extract';
                      const baseUrl = apiUrl.replace('/api/extract', '');
                      const res = await fetch(`${baseUrl}/api/check-quota`);
                      const data = await res.json();
                      setQuotaResults(data);
                    } catch (e) {
                      setQuotaResults({ error: e.message });
                    } finally {
                      setQuotaChecking(false);
                    }
                  }}
                  disabled={quotaChecking}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-xs font-bold transition-all shadow-sm ${
                    quotaChecking
                      ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed'
                      : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'
                  }`}
                >
                  {quotaChecking ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full spin-slow shrink-0" />
                      Đang kiểm tra...
                    </>
                  ) : '🔍 Kiểm Tra Quota Ngay'}
                </button>
              </div>

              {quotaResults && !quotaResults.error && (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 fade-in">
                  {quotaResults.results?.map((r, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-2.5 px-4 py-3.5 rounded-xl border text-xs font-semibold ${
                        r.status === 'ok'
                          ? 'bg-emerald-50/50 border-emerald-100 text-emerald-800'
                          : r.status === 'quota'
                          ? 'bg-amber-50/50 border-amber-100 text-amber-800'
                          : 'bg-rose-50/50 border-rose-100 text-rose-800'
                      }`}
                    >
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        r.status === 'ok' ? 'bg-emerald-500' : r.status === 'quota' ? 'bg-amber-500' : 'bg-rose-500'
                      }`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-extrabold text-slate-800 truncate">{r.name}</span>
                          {r.latency !== undefined && (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0 ${
                              r.latency < 500
                                ? 'bg-emerald-100 text-emerald-800'
                                : r.latency < 1200
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}>
                              ⚡ {r.latency}ms
                            </span>
                          )}
                        </div>
                        <div className="font-bold text-slate-500 mt-1 truncate">{r.message}</div>
                        {r.resetInfo && (
                          <div className={`text-[10px] font-semibold mt-1 ${
                            r.status === 'ok' ? 'text-slate-400' : r.status === 'quota' ? 'text-amber-700 font-bold' : 'text-rose-600'
                          }`}>
                            ⏱ {r.resetInfo}
                          </div>
                        )}
                        {r.details && (
                          <div className="text-[9px] text-slate-400 font-normal mt-1 border-t border-slate-100/50 pt-1 font-mono truncate">
                            ⚙ {r.details}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  <div className="col-span-full space-y-2 pt-2 border-t border-slate-100/60">
                    <div className="text-[10px] text-slate-400 font-medium">
                      Kiểm tra lúc: {new Date(quotaResults.checkedAt).toLocaleTimeString('vi-VN')}
                    </div>
                    <div className="text-[11px] bg-slate-50 border border-slate-150 rounded-xl px-4 py-3 text-slate-500 leading-relaxed">
                      <span className="font-extrabold text-slate-600">⚠ Lưu ý hạn mức:</span> Kết quả trên chỉ kiểm tra xem API key còn <strong>hoạt động hay bị chặn (429)</strong>. Số liệu RPM/TPM/RPD là giới hạn tối đa của plan — <strong>không phải số thực tế còn lại</strong>.
                      <br />
                      Để xem số dùng thực tế từng key Gemini, truy cập{' '}
                      <a
                        href="https://aistudio.google.com/app/rate-limit"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 underline font-extrabold hover:text-blue-800"
                      >
                        aistudio.google.com/app/rate-limit
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {quotaResults?.error && (
                <div className="text-xs text-rose-700 font-bold bg-rose-50 border border-rose-100 rounded-xl px-4 py-3 fade-in">
                  Lỗi kết nối backend: {quotaResults.error}
                </div>
              )}
            </div>
          </div>
        )}
        
      </div>
    </div>
  );
}

export default App;
