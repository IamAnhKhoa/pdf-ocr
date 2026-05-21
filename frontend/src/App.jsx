import { useState, useEffect, Fragment } from 'react';
import ExcelJS from 'exceljs';
import { extractFirstAndLastPage } from './utils/pdfProcessor';

// Hàm hỗ trợ định dạng ngày giờ dạng DD/MM/YYYY hh:mm AM/PM
const formatDate = (date) => {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  const hoursStr = String(hours).padStart(2, '0');
  return `${day}/${month}/${year} ${hoursStr}:${minutes} ${ampm}`;
};

// Component hiển thị đồng hồ thống kê (Stats Gauge)
function QuotaGauge({ title, percentage, color, valueText, description }) {
  const maxArcLength = 179.0;
  const strokeDashoffset = maxArcLength - (maxArcLength * percentage / 100);
  
  let dotColor = 'bg-blue-500';
  if (color === 'green') dotColor = 'bg-emerald-500';
  if (color === 'orange') dotColor = 'bg-amber-500';
  if (color === 'red') dotColor = 'bg-rose-500';

  let strokeColor = '#3b82f6';
  if (color === 'green') strokeColor = '#10b981';
  if (color === 'orange') strokeColor = '#f59e0b';
  if (color === 'red') strokeColor = '#ef4444';

  return (
    <div className="bg-[#0d1726]/60 backdrop-blur-xl border border-[#16253b] rounded-2xl p-5 shadow-lg flex flex-col justify-between hover:border-[#00c2ff]/30 transition-all duration-300">
      <div>
        <span className="text-slate-400 font-bold text-xs text-left block w-full mb-0.5">{title}</span>
        {description && <span className="text-[10px] text-slate-500 block text-left mb-2">{description}</span>}
      </div>
      
      {/* Circle Gauge */}
      <div className="relative w-36 h-36 flex items-center justify-center mx-auto my-2">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
          {/* Background track (270 degrees) */}
          <circle
            cx="50"
            cy="50"
            r="38"
            fill="none"
            stroke="#16253b"
            strokeWidth="7.5"
            strokeDasharray="179 60"
            strokeLinecap="round"
            transform="rotate(135 50 50)"
          />
          {/* Active track (270 degrees) */}
          <circle
            cx="50"
            cy="50"
            r="38"
            fill="none"
            stroke={strokeColor}
            strokeWidth="7.5"
            strokeDasharray="179 60"
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform="rotate(135 50 50)"
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        {/* Center Text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-black text-white tracking-tight">{percentage}%</span>
          <span className="text-[10px] font-bold text-slate-450 mt-1 uppercase tracking-wider">{valueText}</span>
        </div>
      </div>

      {/* Mini progress bar */}
      <div className="w-full mt-2">
        <div className="w-full h-1 bg-[#16253b] rounded-full overflow-hidden">
          <div 
            className="h-full rounded-full transition-all duration-1000 ease-out"
            style={{ 
              width: `${percentage}%`,
              backgroundColor: strokeColor 
            }}
          />
        </div>
      </div>
    </div>
  );
}

function App() {
  const [dataList, setDataList] = useState([]);
  const [dragActive, setDragActive] = useState(false);
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
    if (!item.file || item.id.startsWith('mock-')) {
      // Không chạy xử lý thực tế đối với các tệp dữ liệu mẫu
      return;
    }

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

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = e.dataTransfer.files;
      const newItems = Array.from(files)
        .filter(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
        .map((file, index) => {
          const sizeMB = (file.size / (1024 * 1024)).toFixed(1) + 'MB';
          return {
            id: `${file.name}-${Date.now()}-${index}`,
            fileName: file.name,
            file: file,
            fileSize: sizeMB,
            fileType: 'PDF',
            uploadedBy: 'Admin',
            status: 'pending',
            addedAt: formatDate(new Date()),
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
          };
        });

      if (newItems.length === 0) {
        setError('Vui lòng chọn các file PDF hợp lệ.');
        return;
      }

      setError('');
      setDataList(prev => [...prev, ...newItems]);
    }
  };

  const handleFileUpload = (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const newItems = Array.from(files)
      .filter(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
      .map((file, index) => {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1) + 'MB';
        return {
          id: `${file.name}-${Date.now()}-${index}`,
          fileName: file.name,
          file: file,
          fileSize: sizeMB,
          fileType: 'PDF',
          uploadedBy: 'Admin',
          status: 'pending',
          addedAt: formatDate(new Date()),
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
        };
      });

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

  const PROVIDER_LABELS = {
    gemini: 'Gemini',
    'gemini-via-vercel': 'Gemini (Proxy)',
    openrouter: 'OpenRouter',
    groq: 'Groq'
  };
  const PROVIDER_COLORS = {
    gemini: 'bg-blue-950/40 text-blue-300 border-blue-800/50',
    'gemini-via-vercel': 'bg-blue-950/40 text-blue-300 border-blue-800/50',
    openrouter: 'bg-violet-950/40 text-violet-300 border-violet-800/50',
    groq: 'bg-amber-950/40 text-amber-300 border-amber-850/50',
    '': 'bg-slate-800/40 text-slate-300 border-slate-700/50'
  };

  return (
    <div className="min-h-screen bg-[#050b14] text-slate-200 p-4 md:p-8 font-sans transition-all">
      <div className="max-w-7xl mx-auto space-y-6 w-full">
        
        {/* Centered Tab Navigation (Premium Pill Style) */}
        <div className="flex justify-center gap-3 mb-8">
          {[
            { id: 'ocr', label: 'Trích Xuất OCR' },
            { id: 'stats', label: 'Thống Kê' },
            { id: 'config', label: 'Cấu Hình' }
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`py-2.5 px-6 rounded-lg text-sm font-bold transition-all duration-300 border ${
                  isActive
                    ? 'bg-[#00c2ff] text-[#050b14] border-[#00c2ff] shadow-[0_0_15px_rgba(0,194,255,0.35)]'
                    : 'bg-[#09101c]/80 text-[#8b9bb4] border-[#00c2ff]/30 hover:border-[#00c2ff]/80 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* OCR TAB */}
        {activeTab === 'ocr' && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
            
            {/* Left Area (Queue + Dropzone + Table) - Spans 3 columns */}
            <div className="lg:col-span-3 space-y-6">
              
              {/* Row 1: Queue + Dropzone */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* Column 1: Processing Queue */}
                <div className="md:col-span-1 bg-[#0d1726]/60 backdrop-blur-xl border border-[#16253b] rounded-2xl p-5 shadow-lg flex flex-col justify-between h-[300px]">
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-white font-extrabold text-sm tracking-tight">Processing Queue</span>
                    <button className="text-slate-400 hover:text-white transition-colors text-lg font-bold">•••</button>
                  </div>
                  
                  {/* Queue Items list */}
                  <div className="space-y-2 overflow-y-auto flex-1 pr-1 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
                    {dataList.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-xs text-slate-500 font-semibold py-8">
                        Hàng đợi trống
                      </div>
                    ) : (
                      dataList.map((item) => {
                        const isProcessingRow = item.status === 'processing';
                        const isPending = item.status === 'pending';
                        const isCompleted = item.status === 'completed';
                        const isRetrying = item.status === 'waiting_retry';
                        const isFailed = item.status === 'failed';

                        if (isCompleted) {
                          return (
                            <div key={item.id} className="bg-[#0f1d1e] border border-[#164e52]/40 rounded-xl p-3 text-xs font-bold text-[#2dd4bf] flex items-center justify-between">
                              <span className="truncate max-w-[150px]">{item.fileName}</span>
                              <span className="shrink-0 text-[10px]">Hoàn tất</span>
                            </div>
                          );
                        }

                        if (isProcessingRow) {
                          return (
                            <div key={item.id} className="relative overflow-hidden rounded-xl bg-[#122647] border border-blue-900/50 p-3 text-xs font-bold text-blue-300">
                              <div className="flex justify-between items-center mb-1">
                                <span className="truncate max-w-[120px]">{item.fileName}</span>
                                <span className="shrink-0 text-[10px]">Đang xử lý {item.progress || 85}%</span>
                              </div>
                              <div className="w-full h-1 bg-blue-950 rounded-full overflow-hidden">
                                <div className="h-full bg-blue-400 rounded-full animate-pulse" style={{ width: `${item.progress || 85}%` }} />
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div key={item.id} className="bg-[#131b2c] border border-[#1e2d4a]/50 rounded-xl p-3 text-xs font-semibold text-slate-400 flex items-center justify-between">
                            <span className="truncate max-w-[150px]">{item.fileName}</span>
                            <span className="shrink-0 text-[10px]">Chờ</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                  
                  {dataList.length > 0 && (
                    <div className="flex justify-between items-center border-t border-[#16253b] pt-3 mt-3 text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">
                      <span>Tổng: {stats.total}</span>
                      <button onClick={handleClearAll} className="text-rose-450 hover:text-rose-350 transition-colors">Xóa hết</button>
                    </div>
                  )}
                </div>

                {/* Column 2 & 3: Dropzone */}
                <div className="md:col-span-2 bg-[#0d1726]/60 backdrop-blur-xl border border-[#16253b] rounded-2xl p-5 shadow-lg h-[300px]">
                  <label 
                    htmlFor="file-upload" 
                    onDragEnter={handleDrag}
                    onDragOver={handleDrag}
                    onDragLeave={handleDrag}
                    onDrop={handleDrop}
                    className={`cursor-pointer flex flex-col items-center justify-center h-full border-2 border-dashed rounded-2xl transition-all duration-300 relative ${
                      dragActive 
                        ? 'border-[#00c2ff] bg-[#00c2ff]/10 scale-[1.01] shadow-[0_0_20px_rgba(0,194,255,0.25)]' 
                        : 'border-[#00c2ff]/50 bg-[#0a1222]/80 bg-radial from-[#132c4a]/20 via-transparent to-transparent hover:bg-slate-800/15 hover:border-[#00c2ff]'
                    } ${
                      isProcessing ? 'opacity-85 pointer-events-none' : ''
                    }`}
                  >
                    <div className="flex items-center justify-center gap-4 text-slate-400 mb-3">
                      <div className="relative">
                        <svg className="w-12 h-14 text-slate-500" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z"/>
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-slate-900 mt-2">PDF</span>
                      </div>
                      <span className="text-lg font-black text-slate-650">+</span>
                      <svg className="w-10 h-10 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    </div>

                    <h3 className="font-extrabold text-slate-200 text-sm md:text-base leading-snug">
                      Thả tệp tin PDF vào đây hoặc nhấn để tải lên
                    </h3>
                    
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
                    <div className="absolute bottom-2 left-6 right-6 p-2 bg-rose-950/40 border border-rose-900/50 text-rose-300 rounded-lg text-xs font-semibold text-center">
                      Lỗi: {error}
                    </div>
                  )}
                </div>
              </div>

              {/* Row 2: Data results table */}
              <div className="bg-[#0d1726]/60 backdrop-blur-xl border border-[#16253b] rounded-2xl shadow-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-[#16253b] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <h2 className="text-sm md:text-base font-black text-white tracking-tight">
                    Data results
                  </h2>
                  <div className="flex flex-wrap items-center gap-2">
                    {dataList.length > 0 && (
                      <>
                        <button
                          id="btn-copy-all"
                          onClick={(e) => { e.stopPropagation(); handleCopyAll(); }}
                          className={`px-4 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                            copiedAll 
                              ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/60 shadow-[0_0_10px_rgba(16,185,129,0.15)]' 
                              : 'bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 border-slate-700/60 shadow-sm'
                          }`}
                        >
                          {copiedAll ? 'Đã copy!' : '📋 Copy Kết Quả'}
                        </button>
                        <button
                          id="btn-export-excel"
                          onClick={(e) => { e.stopPropagation(); exportToExcel(); }}
                          disabled={dataList.length === 0}
                          className={`flex items-center justify-center gap-2 px-4 py-1.5 rounded-lg font-bold text-xs transition-all shadow-md ${
                            dataList.length === 0 
                              ? 'bg-slate-800/30 text-slate-650 border border-slate-800 cursor-not-allowed' 
                              : 'bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500/30 shadow-[0_4px_12px_rgba(16,185,129,0.2)]'
                          }`}
                        >
                          📥 Xuất Excel
                        </button>
                      </>
                    )}
                  </div>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left text-slate-300 border-collapse">
                    <thead className="text-[11px] text-slate-450 uppercase bg-[#09101c]/80 border-b border-[#16253b] font-extrabold tracking-wider">
                      <tr>
                        <th className="px-3 py-3 w-16 text-center text-slate-400">STT</th>
                        <th className="px-3 py-3 min-w-[95px] text-slate-400">Số Đến</th>
                        <th className="px-3 py-3 min-w-[130px] text-slate-400">Số Ký Hiệu</th>
                        <th className="px-3 py-3 min-w-[280px] text-slate-400">Nội Dung Văn Bản</th>
                        <th className="px-3 py-3 min-w-[110px] text-slate-400">Ngày Đến</th>
                        <th className="px-3 py-3 min-w-[110px] text-slate-400">Thời Hạn</th>
                        <th className="px-3 py-3 min-w-[160px] text-slate-400">Ý Kiến</th>
                        <th className="px-3 py-3 min-w-[120px] text-slate-400">Tiến Độ</th>
                        <th className="px-3 py-3 min-w-[120px] text-slate-400">VB Trả Lời</th>
                        <th className="px-3 py-3 w-12 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#16253b] bg-[#0c1322]/40">
                      {dataList.length === 0 ? (
                        <tr>
                          <td colSpan="10" className="px-6 py-16 text-center text-slate-500 font-semibold text-sm">
                            Chưa có tệp tin nào trong hàng đợi. Nhấn nút "Chọn File" ở trên hoặc kéo thả để bắt đầu.
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

                          const fileSize = item.fileSize || '5.2MB';
                          const fileType = item.fileType || 'PDF';
                          const uploadedBy = item.uploadedBy || 'Admin';
                          const addedAt = item.addedAt || '15/06/2026 10:15 AM';

                          const rowHighlightClass = isExpanded 
                            ? 'bg-[#122647]/30 border-l-4 border-l-[#00c2ff]' 
                            : 'border-b border-[#16253b] hover:bg-slate-800/15';

                          return (
                            <Fragment key={item.id}>
                              <tr className={`transition-all duration-200 ${rowHighlightClass}`}>
                                {/* STT */}
                                <td className="px-3 py-2 text-center">
                                  <div className="flex items-center justify-center gap-1.5">
                                    <button 
                                      onClick={() => toggleRow(item.id)}
                                      className={`w-5 h-5 rounded font-black text-[10px] flex items-center justify-center border transition-all shrink-0 ${
                                        isExpanded 
                                          ? 'bg-[#00c2ff] text-[#050b14] border-[#00c2ff]' 
                                          : 'bg-[#0a1222] hover:bg-[#00c2ff]/10 text-slate-300 border-[#1b2d4a] hover:border-[#00c2ff]/50 hover:text-[#00c2ff] shadow-sm'
                                      }`}
                                    >
                                      {isExpanded ? '−' : '+'}
                                    </button>
                                    <span className="text-slate-400 font-bold text-sm w-4 text-center">{index + 1}</span>
                                  </div>
                                </td>

                                {/* Số Đến */}
                                <td className="px-2 py-1.5">
                                  {isProcessingRow ? (
                                    <div className="bg-[#1b2d4a]/50 animate-pulse rounded h-7 w-14 mx-1" />
                                  ) : (
                                    <input 
                                      type="text" 
                                      value={item.soDen || ''} 
                                      onChange={(e) => handleUpdateSoDen(index, e.target.value)}
                                      className="w-full bg-transparent hover:bg-[#16253b]/30 focus:bg-[#0a1222]/90 focus:ring-1 focus:ring-[#00c2ff] rounded border-0 px-2 py-1 text-white font-bold text-[14px] outline-none transition-all"
                                      placeholder="..."
                                    />
                                  )}
                                </td>

                                {/* Số Ký Hiệu */}
                                <td className="px-2 py-1.5">
                                  {isProcessingRow ? (
                                    <div className="bg-[#1b2d4a]/50 animate-pulse rounded h-7 w-24 mx-1" />
                                  ) : (
                                    <input 
                                      type="text" 
                                      value={item.soKyHieu || ''} 
                                      onChange={(e) => handleUpdateField(item.id, 'soKyHieu', e.target.value)}
                                      className="w-full bg-transparent hover:bg-[#16253b]/30 focus:bg-[#0a1222]/90 focus:ring-1 focus:ring-[#00c2ff] rounded border-0 px-2 py-1 text-white font-bold text-[14px] outline-none transition-all"
                                      placeholder="..."
                                    />
                                  )}
                                </td>

                                {/* Nội Dung Văn Bản */}
                                <td className="px-2 py-1.5">
                                  {isProcessingRow ? (
                                    <div className="space-y-1.5 py-1 px-1">
                                      <div className="bg-[#1b2d4a]/50 animate-pulse rounded h-3.5 w-full" />
                                      <div className="bg-[#1b2d4a]/50 animate-pulse rounded h-3.5 w-4/5" />
                                    </div>
                                  ) : (
                                    <textarea
                                      rows={2}
                                      value={item.noiDung || ''} 
                                      onChange={(e) => handleUpdateField(item.id, 'noiDung', e.target.value)}
                                      className="w-full bg-transparent hover:bg-[#16253b]/30 focus:bg-[#0a1222]/90 focus:ring-1 focus:ring-[#00c2ff] rounded border-0 px-2 py-1 text-slate-200 text-[14px] outline-none transition-all resize-y leading-relaxed font-normal min-h-[44px]"
                                      placeholder="..."
                                    />
                                  )}
                                </td>

                                {/* Ngày Đến */}
                                <td className="px-2 py-1.5">
                                  {isProcessingRow ? (
                                    <div className="bg-[#1b2d4a]/50 animate-pulse rounded h-7 w-20 mx-1" />
                                  ) : (
                                    <input 
                                      type="text" 
                                      value={item.ngayVBDen || ''} 
                                      onChange={(e) => handleUpdateField(item.id, 'ngayVBDen', e.target.value)}
                                      className="w-full bg-transparent hover:bg-[#16253b]/30 focus:bg-[#0a1222]/90 focus:ring-1 focus:ring-[#00c2ff] rounded border-0 px-2 py-1 text-slate-200 text-[14px] outline-none transition-all"
                                      placeholder="..."
                                    />
                                  )}
                                </td>

                                {/* Thời Hạn */}
                                <td className="px-2 py-1.5">
                                  <input 
                                    type="text" 
                                    value={item.thoiHanGiaiQuyet || ''} 
                                    onChange={(e) => handleUpdateField(item.id, 'thoiHanGiaiQuyet', e.target.value)}
                                    className="w-full bg-transparent hover:bg-[#16253b]/30 focus:bg-[#0a1222]/90 focus:ring-1 focus:ring-[#00c2ff] rounded border-0 px-2 py-1 text-slate-200 text-[14px] outline-none transition-all"
                                    placeholder="..."
                                  />
                                </td>

                                {/* Ý Kiến */}
                                <td className="px-2 py-1.5">
                                  <textarea
                                    rows={2}
                                    value={item.yKienChiDao || ''} 
                                    onChange={(e) => handleUpdateField(item.id, 'yKienChiDao', e.target.value)}
                                    className="w-full bg-transparent hover:bg-[#16253b]/30 focus:bg-[#0a1222]/90 focus:ring-1 focus:ring-[#00c2ff] rounded border-0 px-2 py-1 text-slate-200 text-[14px] outline-none transition-all resize-y leading-relaxed font-normal min-h-[44px]"
                                    placeholder="..."
                                  />
                                </td>

                                {/* Tiến Độ */}
                                <td className="px-2 py-1.5">
                                  <input 
                                    type="text" 
                                    value={item.tienDoGiaiQuyet || ''} 
                                    onChange={(e) => handleUpdateField(item.id, 'tienDoGiaiQuyet', e.target.value)}
                                    className="w-full bg-transparent hover:bg-[#16253b]/30 focus:bg-[#0a1222]/90 focus:ring-1 focus:ring-[#00c2ff] rounded border-0 px-2 py-1 text-slate-200 text-[14px] outline-none transition-all"
                                    placeholder="..."
                                  />
                                </td>

                                {/* VB Trả Lời */}
                                <td className="px-2 py-1.5">
                                  <input 
                                    type="text" 
                                    value={item.soKyHieuVBTraLoi || ''} 
                                    onChange={(e) => handleUpdateField(item.id, 'soKyHieuVBTraLoi', e.target.value)}
                                    className="w-full bg-transparent hover:bg-[#16253b]/30 focus:bg-[#0a1222]/90 focus:ring-1 focus:ring-[#00c2ff] rounded border-0 px-2 py-1 text-slate-200 text-[14px] outline-none transition-all"
                                    placeholder="..."
                                  />
                                </td>

                                {/* Xóa dòng */}
                                <td className="px-3 py-2 text-center">
                                  <button
                                    onClick={() => handleRemoveFile(item.id)}
                                    className="w-8 h-8 rounded-lg hover:bg-rose-950/50 text-rose-450 hover:text-rose-350 flex items-center justify-center transition-colors font-bold text-base"
                                    title="Xóa dòng này"
                                  >
                                    🗑️
                                  </button>
                                </td>
                              </tr>

                              {isExpanded && (
                                <tr className="bg-[#09101c]/80">
                                  <td colSpan="10" className="px-6 py-4 border-b border-[#16253b]">
                                    <div className="bg-[#101c30]/70 border border-[#1b2d4a] rounded-xl p-5 space-y-4 text-left" onClick={(e) => e.stopPropagation()}>
                                      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 text-sm">
                                        <div className="space-y-1">
                                          <span className="text-slate-500 font-bold text-[10px] uppercase block tracking-wider">Tên file PDF</span>
                                          <span className="text-slate-300 font-bold break-all text-sm">{item.fileName}</span>
                                        </div>
                                        <div className="space-y-1">
                                          <span className="text-slate-500 font-bold text-[10px] uppercase block tracking-wider">Thông tin file</span>
                                          <span className="text-slate-400 text-xs block">Kích thước: {fileSize} | Loại: {fileType} | Ngày tải: {addedAt}</span>
                                        </div>
                                        <div className="space-y-1">
                                          <span className="text-slate-500 font-bold text-[10px] uppercase block tracking-wider">Trạng thái đọc OCR</span>
                                          <div className="flex items-center gap-2">
                                            {isProcessingRow && <span className="font-semibold text-blue-400">Đang đọc <span className="dot-bounce text-blue-400"><span></span><span></span><span></span></span></span>}
                                            {isPending && <span className="font-semibold text-slate-400">Chờ xử lý</span>}
                                            {isCompleted && <span className="font-semibold text-emerald-400">✔ Thành công</span>}
                                            {isRetrying && <span className="font-semibold text-amber-400">Thử lại {item.retryCount}/3</span>}
                                            {isFailed && <span className="font-semibold text-rose-400">✗ Thất bại</span>}
                                            {isFailed && (
                                              <span className="text-rose-300 text-xs font-semibold">({item.error || 'Lỗi kết nối'})</span>
                                            )}
                                            {isRetrying && (
                                              <span className="text-amber-300 text-xs font-semibold animate-pulse">(Tự động kết nối lại...)</span>
                                            )}
                                          </div>
                                          {isProcessingRow && (
                                            <div className="w-44 h-1.5 bg-slate-800 rounded-full overflow-hidden mt-2">
                                              <div className="h-full bg-blue-500 rounded-full animate-[progress_2s_ease-in-out_infinite]" style={{ width: '100%' }}></div>
                                            </div>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                                          <button
                                            onClick={() => handleCopyRow(item)}
                                            className={`px-3 py-1.5 rounded-lg border font-bold text-xs transition-colors shadow-sm ${
                                              copiedRowId === item.id
                                                ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/60'
                                                : 'bg-slate-850 hover:bg-slate-750 text-slate-350 border-slate-750'
                                            }`}
                                          >
                                            {copiedRowId === item.id ? 'Đã copy!' : '📋 Copy Kết Quả'}
                                          </button>
                                          {(item.status === 'failed' || item.status === 'waiting_retry') && (
                                            <button
                                              onClick={() => handleRetryFile(item)}
                                              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-colors shadow-md animate-pulse"
                                            >
                                              🔄 Thử lại
                                            </button>
                                          )}
                                        </div>
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
            </div>

            {/* Right Sidebar (Stats Gauge Cards) - Spans 1 column */}
            <div className="lg:col-span-1 space-y-6">
              <QuotaGauge 
                title="Tỷ Lệ Thành Công" 
                percentage={stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0} 
                color="green" 
                valueText={stats.total > 0 ? `${stats.completed}/${stats.total} tệp` : "0 tệp"} 
                description="Tỷ lệ tệp PDF đã hoàn tất đọc OCR thành công"
              />
              <QuotaGauge 
                title="Processing Queue" 
                percentage={stats.total > 0 ? Math.round(((stats.completed + stats.processing) / stats.total) * 100) : 0} 
                color="orange" 
                valueText={stats.total > 0 ? `${stats.completed + stats.processing}/${stats.total} tệp` : "Trống"} 
                description="Tỷ lệ tệp đang/đã hoàn tất xử lý"
              />
              <QuotaGauge 
                title="Tỷ Lệ Lỗi (Thất Bại)" 
                percentage={stats.total > 0 ? Math.round((stats.failed / stats.total) * 100) : 0} 
                color="red" 
                valueText={stats.total > 0 ? `${stats.failed}/${stats.total} tệp lỗi` : "0 tệp"} 
                description="Tỷ lệ tệp gặp lỗi trong hàng đợi"
              />
            </div>
          </div>
        )}

        {/* STATS TAB */}
        {activeTab === 'stats' && (
          <div className="space-y-6 fade-in">
            {/* Stats summary cards */}
            {statsLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/60 rounded-2xl p-5 shadow-lg space-y-3 breathe">
                    <div className="w-8 h-8 bg-slate-800 rounded-lg animate-pulse" />
                    <div className="h-4 bg-slate-800 rounded w-1/2 animate-pulse" />
                    <div className="h-6 bg-slate-800 rounded w-3/4 animate-pulse" />
                  </div>
                ))}
              </div>
            ) : statsError ? (
              <div className="bg-rose-950/30 border border-rose-900/50 text-rose-300 rounded-2xl p-6 text-center shadow-lg">
                <span className="text-2xl mb-2 block">⚠️</span>
                <p className="font-bold text-sm mb-3">Không thể tải dữ liệu thống kê từ hệ thống</p>
                <p className="text-xs text-rose-400 mb-4">{statsError}</p>
                <button
                  id="btn-refresh-stats"
                  onClick={fetchStats}
                  className="px-4 py-2 bg-rose-600 text-white rounded-lg font-bold text-xs hover:bg-rose-500 transition-colors shadow-md"
                >
                  🔄 Tải lại dữ liệu
                </button>
              </div>
            ) : !statsData || statsData.summary.total === 0 ? (
              <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/60 rounded-2xl p-16 text-center shadow-lg">
                <span className="text-4xl mb-4 block">📊</span>
                <p className="font-bold text-white text-base mb-1">Chưa có dữ liệu thống kê</p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                  Hệ thống chưa ghi nhận bất kỳ lượt trích xuất tài liệu nào. Hãy bắt đầu tải file lên để lưu dữ liệu thống kê.
                </p>
              </div>
            ) : (
              <>
                {/* 4 Cards Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {/* Card 1: Tổng cộng */}
                  <div className="bg-gradient-to-br from-blue-950/40 to-slate-900/40 rounded-2xl border border-blue-900/30 p-5 shadow-lg hover:shadow-xl hover:scale-[1.01] hover:border-blue-800/50 transition-all duration-300">
                    <div className="w-10 h-10 bg-blue-500/10 text-blue-450 rounded-xl flex items-center justify-center font-bold text-lg mb-3 border border-blue-500/10">
                      📂
                    </div>
                    <span className="text-xs text-blue-400/80 font-bold block uppercase tracking-wider">Tổng file xử lý</span>
                    <span className="text-2xl md:text-3xl font-extrabold text-white mt-1 block">{statsData.summary.total}</span>
                    <span className="text-[10px] text-blue-400 font-semibold mt-1 block">Tất cả các phiên làm việc</span>
                  </div>

                  {/* Card 2: Thành công */}
                  <div className="bg-gradient-to-br from-emerald-950/40 to-slate-900/40 rounded-2xl border border-emerald-900/30 p-5 shadow-lg hover:shadow-xl hover:scale-[1.01] hover:border-emerald-800/50 transition-all duration-300">
                    <div className="w-10 h-10 bg-emerald-500/10 text-emerald-455 rounded-xl flex items-center justify-center font-bold text-lg mb-3 border border-emerald-500/10">
                      ✅
                    </div>
                    <span className="text-xs text-emerald-400/80 font-bold block uppercase tracking-wider">Trích xuất thành công</span>
                    <span className="text-2xl md:text-3xl font-extrabold text-white mt-1 block">{statsData.summary.success}</span>
                    <span className="text-[10px] text-emerald-400 font-semibold mt-1 block">Lưu trữ đầy đủ dữ liệu</span>
                  </div>

                  {/* Card 3: Thất bại */}
                  <div className="bg-gradient-to-br from-rose-950/40 to-slate-900/40 rounded-2xl border border-rose-900/30 p-5 shadow-lg hover:shadow-xl hover:scale-[1.01] hover:border-rose-800/50 transition-all duration-300">
                    <div className="w-10 h-10 bg-rose-500/10 text-rose-455 rounded-xl flex items-center justify-center font-bold text-lg mb-3 border border-rose-500/10">
                      ❌
                    </div>
                    <span className="text-xs text-rose-400/80 font-bold block uppercase tracking-wider">Trích xuất thất bại</span>
                    <span className="text-2xl md:text-3xl font-extrabold text-white mt-1 block">{statsData.summary.failed}</span>
                    <span className="text-[10px] text-rose-405 font-semibold mt-1 block">Bị lỗi API / Quota limit</span>
                  </div>

                  {/* Card 4: Tỉ lệ */}
                  <div className="bg-gradient-to-br from-amber-950/40 to-slate-900/40 rounded-2xl border border-amber-900/30 p-5 shadow-lg hover:shadow-xl hover:scale-[1.01] hover:border-amber-800/50 transition-all duration-300">
                    <div className="w-10 h-10 bg-amber-500/10 text-amber-455 rounded-xl flex items-center justify-center font-bold text-lg mb-3 border border-amber-500/10">
                      🎯
                    </div>
                    <span className="text-xs text-amber-400/80 font-bold block uppercase tracking-wider">Tỷ lệ thành công</span>
                    <span className="text-2xl md:text-3xl font-extrabold text-white mt-1 block">
                      {(statsData.summary.total > 0 ? (statsData.summary.success / statsData.summary.total * 100) : 0).toFixed(1)}%
                    </span>
                    <span className="text-[10px] text-amber-400 font-semibold mt-1 block">Hiệu suất trích xuất AI</span>
                  </div>
                </div>

                {/* SVG Graph Section */}
                {statsData.daily && statsData.daily.length > 0 && (
                  <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/60 rounded-2xl p-6 shadow-xl">
                    <h3 className="text-sm font-bold text-white mb-6 flex items-center gap-2">
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
                                  <stop offset="100%" stopColor="#047857" stopOpacity="0.8"/>
                                </linearGradient>
                                <linearGradient id="barGradFailed" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#f43f5e"/>
                                  <stop offset="100%" stopColor="#be123c" stopOpacity="0.8"/>
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
                                      stroke="#1e293b"
                                      strokeWidth="1.5"
                                      strokeDasharray={index === 0 ? "0" : "4 4"}
                                    />
                                    <text
                                      x={paddingLeft - 8}
                                      y={yPos + 4}
                                      textAnchor="end"
                                      className="fill-slate-500 font-bold text-[9px] font-mono"
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
                                        isHovered ? 'fill-blue-400' : 'fill-slate-500'
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
                                          stroke="#1e293b"
                                          strokeWidth="1"
                                          className="opacity-95 shadow-lg"
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
                <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/60 rounded-2xl shadow-xl overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-800/60 flex justify-between items-center">
                    <h3 className="text-sm font-bold text-white">
                      Chi tiết lưu trữ thống kê theo ngày
                    </h3>
                    <span className="text-slate-550 text-xs font-bold">Dữ liệu thời gian thực</span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead className="bg-slate-950/60 text-[11px] text-slate-455 uppercase font-bold tracking-wider border-b border-slate-800/80">
                        <tr>
                          <th className="px-6 py-3">Ngày làm việc</th>
                          <th className="px-6 py-3">Tổng số file</th>
                          <th className="px-6 py-3">Thành công</th>
                          <th className="px-6 py-3">Thất bại</th>
                          <th className="px-6 py-3">Tỉ lệ thành công</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 bg-[#0c101d]/60 text-slate-300">
                        {[...statsData.daily].reverse().map((d, index) => {
                          const rate = d.total > 0 ? ((d.success / d.total) * 100).toFixed(1) : 0;
                          
                          // Format YYYY-MM-DD -> DD/MM/YYYY
                          const parts = d.date.split('-');
                          const formattedDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : d.date;

                          return (
                            <tr key={index} className="hover:bg-slate-800/20 transition-colors">
                              <td className="px-6 py-3 font-bold text-slate-200">{formattedDate}</td>
                              <td className="px-6 py-3 font-semibold text-slate-400">{d.total}</td>
                              <td className="px-6 py-3 text-emerald-400 font-bold">{d.success}</td>
                              <td className="px-6 py-3 text-rose-450 font-semibold">{d.failed}</td>
                              <td className="px-6 py-3">
                                <span className={`px-2 py-0.5 rounded-md font-bold text-xs ${
                                  rate >= 90 
                                    ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/60' 
                                    : rate >= 70 
                                    ? 'bg-amber-950/40 text-amber-300 border border-amber-800/60' 
                                    : 'bg-rose-950/40 text-rose-300 border border-rose-800/60'
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
          <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/60 rounded-2xl p-6 space-y-6 shadow-xl fade-in">
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">
                Tham số cấu hình nâng cao dịch vụ
              </h3>
              <p className="text-slate-400 text-xs mt-0.5 font-normal">
                Tùy chỉnh luồng chạy song song và kênh kết nối AI nhận dạng tài liệu
              </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 border-b border-slate-800/80 pb-6">
              {/* Concurrency Limit */}
              <div className="space-y-2 col-span-1">
                <label className="block text-xs font-bold text-slate-300 flex justify-between">
                  <span>Số luồng chạy đồng thời:</span>
                  <span className="text-blue-400 font-extrabold">{concurrency} luồng</span>
                </label>
                <div className="flex items-center gap-3 bg-slate-950/40 border border-slate-800 rounded-xl px-4 py-3">
                  <input
                    id="input-concurrency"
                    type="range"
                    min="1"
                    max="10"
                    value={concurrency}
                    onChange={(e) => setConcurrency(parseInt(e.target.value, 10))}
                    className="w-full accent-blue-500 cursor-pointer"
                  />
                </div>
                <span className="text-[10px] text-slate-500 block leading-snug">
                  Số lượng file PDF sẽ được gửi đồng thời lên máy chủ AI. Khuyên dùng 5-7 luồng.
                </span>
              </div>

              {/* Provider Selection */}
              <div className="space-y-2 col-span-2">
                <label className="block text-xs font-bold text-slate-300">Chọn kênh kết nối API (Dự phòng thông minh):</label>
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
                          ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-600/20'
                          : 'bg-slate-950/40 border-slate-800 hover:bg-slate-800/40 text-slate-350'
                      }`}
                    >
                      <div className="font-bold text-xs md:text-sm">{p.label}</div>
                      <div className={`text-[10px] mt-0.5 font-medium ${provider === p.value ? 'text-blue-100' : 'text-slate-500'}`}>
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
                  <span className="font-bold text-slate-200 text-xs block">Kiểm tra hạn mức API (Quota):</span>
                  <span className="text-[10px] text-slate-500 block mt-0.5">Xác thực trạng thái hoạt động của các API Key trong hệ thống</span>
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
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-xs font-bold transition-all shadow-md ${
                    quotaChecking
                      ? 'bg-slate-900/30 text-slate-600 border-slate-850 cursor-not-allowed'
                      : 'bg-blue-950/40 hover:bg-blue-900/40 text-blue-300 border-blue-800/60'
                  }`}
                >
                  {quotaChecking ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full spin-slow shrink-0" />
                      Đang kiểm tra...
                    </>
                  ) : '🔍 Kiểm Tra Quota Ngay'}
                </button>
              </div>

              {quotaResults && !quotaResults.error && (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 fade-in">
                  {quotaResults.results?.map((r, i) => {
                    const isGeoBlock = r.message?.toLowerCase().includes('location') || r.details?.toLowerCase().includes('location');
                    const isGroqForbidden = r.provider === 'groq' && (r.message?.toLowerCase().includes('forbidden') || r.details?.toLowerCase().includes('403'));
                    
                    let statusClass = 'bg-rose-950/30 border-rose-900/50 text-rose-300';
                    let dotClass = 'bg-rose-500';
                    let displayMessage = r.message;
                    let displayResetInfo = r.resetInfo;
                    
                    if (r.status === 'ok') {
                      statusClass = 'bg-emerald-950/30 border-emerald-900/50 text-emerald-300';
                      dotClass = 'bg-emerald-500';
                    } else if (r.status === 'quota') {
                      statusClass = 'bg-amber-950/30 border-amber-900/50 text-amber-300';
                      dotClass = 'bg-amber-555';
                    } else if (isGeoBlock) {
                      statusClass = 'bg-amber-950/30 border-amber-900/50 text-amber-300';
                      dotClass = 'bg-amber-555';
                      displayMessage = 'IP Edge bị Google giới hạn địa lý';
                      displayResetInfo = 'Hệ thống tự động chuyển tiếp qua OpenRouter miễn phí';
                    } else if (isGroqForbidden) {
                      statusClass = 'bg-amber-950/30 border-amber-900/50 text-amber-300';
                      dotClass = 'bg-amber-555';
                      displayMessage = 'IP Edge bị chặn. Sẽ tự động chuyển tiếp';
                      displayResetInfo = 'Hệ thống tự động chuyển tiếp qua OpenRouter/Llama';
                    }

                    return (
                      <div
                        key={i}
                        className={`flex items-center gap-2.5 px-4 py-3.5 rounded-xl border text-xs font-semibold ${statusClass}`}
                      >
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotClass}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-extrabold text-slate-200 truncate">{r.name}</span>
                            {r.latency !== undefined && (
                              <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0 ${
                                r.latency < 500
                                  ? 'bg-emerald-900/40 text-emerald-300'
                                  : r.latency < 1200
                                  ? 'bg-amber-900/40 text-amber-300'
                                  : 'bg-rose-900/40 text-rose-300'
                              }`}>
                                ⚡ {r.latency}ms
                              </span>
                            )}
                          </div>
                          <div className="font-bold text-slate-400 mt-1 truncate">{displayMessage}</div>
                          {displayResetInfo && (
                            <div className={`text-[10px] font-semibold mt-1 ${
                              r.status === 'ok' ? 'text-slate-500' : 'text-amber-400 font-bold'
                            }`}>
                              ⏱ {displayResetInfo}
                            </div>
                          )}
                          {r.details && (
                            <div className="text-[9px] text-slate-500 font-normal mt-1 border-t border-slate-800/40 pt-1 font-mono truncate">
                              ⚙ {r.details}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div className="col-span-full space-y-2 pt-2 border-t border-slate-800/60">
                    <div className="text-[10px] text-slate-500 font-medium">
                      Kiểm tra lúc: {new Date(quotaResults.checkedAt).toLocaleTimeString('vi-VN')}
                    </div>
                    <div className="text-[11px] bg-slate-950/40 border border-slate-850 rounded-xl px-4 py-3 text-slate-400 leading-relaxed">
                      <span className="font-extrabold text-slate-300">⚠ Lưu ý hạn mức:</span> Kết quả trên chỉ kiểm tra xem API key còn <strong>hoạt động hay bị chặn (429)</strong>. Số liệu RPM/TPM/RPD là giới hạn tối đa của plan — <strong>không phải số thực tế còn lại</strong>.
                      <br />
                      Để xem số dùng thực tế từng key Gemini, truy cập{' '}
                      <a
                        href="https://aistudio.google.com/app/rate-limit"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 underline font-extrabold hover:text-blue-300"
                      >
                        aistudio.google.com/app/rate-limit
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {quotaResults?.error && (
                <div className="text-xs text-rose-300 font-bold bg-rose-950/30 border border-rose-900/50 rounded-xl px-4 py-3 fade-in">
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
