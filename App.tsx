import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Upload,
  FileText,
  Image as ImageIcon,
  CheckCircle2,
  Loader2,
  Copy,
  Download,
  Sparkles,
  ArrowRight,
  RefreshCw,
  AlertCircle,
  Save,
  ExternalLink
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { toPng } from 'html-to-image';
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { generateBlogContent, generateImage, generateImagePrompts, type BlogContent } from './gemini';

// PDF.js 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const LOADING_MESSAGES = [
  "제안서를 꼼꼼하게 읽고 있어요...",
  "핵심 가치를 추출하는 중입니다.",
  "감성을 담아 글을 다듬고 있어요.",
  "관련 이론을 찾아 전문성을 더하는 중...",
  "썸네일 이미지 생성 중...",
  "잠시만 기다려 주세요, 거의 다 되었어요!"
];

const GOOGLE_DOC_URL = 'https://docs.google.com/document/d/19d5e01j5IYakOKftv-7Y28T8oo0SStGKRwGej1QK6Wk/edit';

// ─── 토스트 메시지 타입 ────────────────────────────────────────────────────
type ToastType = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingRemaining, setIsGeneratingRemaining] = useState(false);
  const [blogData, setBlogData] = useState<BlogContent | null>(null);
  const [thumbnailTitle, setThumbnailTitle] = useState('');
  const [imagePrompts, setImagePrompts] = useState<string[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [isSavingToDocs, setIsSavingToDocs] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isProduction, setIsProduction] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastIdRef = useRef(0);

  // ─── 토스트 헬퍼 ──────────────────────────────────────────────────────────
  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  // ─── 인증 상태 확인 ───────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/auth/status')
      .then(r => r.json())
      .then(({ isAuthenticated, isProduction: isProd }) => {
        setIsAuthenticated(isAuthenticated);
        setIsProduction(isProd !== false);
      })
      .catch(() => setIsAuthenticated(false));
  }, []);

  // ─── OAuth 팝업 메시지 수신 ────────────────────────────────────────────────
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setIsAuthenticated(true);
        showToast('Google 인증이 완료되었습니다.', 'success');
        // 인증 완료 후 자동으로 저장 시도
        if (blogData) {
          setTimeout(() => handleSaveToDocs(), 500);
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [blogData]);

  // ─── PDF 텍스트 추출 ─────────────────────────────────────────────────────
  const extractTextFromPdf = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = await Promise.all(
      Array.from({ length: pdf.numPages }, (_, i) =>
        pdf.getPage(i + 1).then(page =>
          page.getTextContent().then(c =>
            c.items.map((item: any) => item.str).join(' ')
          )
        )
      )
    );
    return pages.join('\n');
  };

  // ─── 파일 핸들링 ─────────────────────────────────────────────────────────
  const handleFileChange = useCallback(async (selectedFile: File) => {
    if (selectedFile.type !== 'application/pdf') {
      setError('PDF 파일만 업로드 가능합니다.');
      return;
    }
    setFile(selectedFile);
    setError(null);
    setBlogData(null);
    setImages([]);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFileChange(droppedFile);
  }, [handleFileChange]);

  // ─── 블로그 생성 ─────────────────────────────────────────────────────────
  const processProposal = async () => {
    if (!file) return;
    setIsParsing(true);
    setError(null);
    setImages([]);

    const msgInterval = setInterval(() => {
      setLoadingMsgIdx(prev => (prev + 1) % LOADING_MESSAGES.length);
    }, 3000);

    try {
      const text = await extractTextFromPdf(file);
      setIsParsing(false);
      setIsGenerating(true);

      const authors = ['레이첼', '지아'] as const;
      const randomAuthor = authors[Math.floor(Math.random() * authors.length)];

      const content = await generateBlogContent(text, randomAuthor, thumbnailTitle);
      setBlogData(content);

      // 블로그 생성마다 새 이미지 프롬프트 조합 생성
      const currentPrompts = generateImagePrompts();
      setImagePrompts(currentPrompts);

      // 썸네일 2장 순차 생성
      const generatedImages: string[] = [];
      for (let i = 0; i < 2; i++) {
        if (currentPrompts[i]) {
          try {
            const result = await generateImage(currentPrompts[i]);
            generatedImages.push(result.imageData);
            if (result.isPlaceholder) {
              showToast('이미지 생성 서비스가 일시적으로 불가합니다. 임시 이미지로 대체됩니다.', 'error');
            }
          } catch {
            generatedImages.push(`https://picsum.photos/seed/samsotta-${Date.now()}-${i}/1024/1024?blur=2`);
            showToast('이미지 생성에 실패했습니다. 임시 이미지로 대체됩니다.', 'error');
          }
          setImages([...generatedImages]);
        }
      }
    } catch (err: any) {
      console.error(err);
      setError('처리에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      setIsParsing(false);
      setIsGenerating(false);
      clearInterval(msgInterval);
    }
  };

  // ─── 본문 이미지 생성 (4장) ───────────────────────────────────────────────
  const generateRemainingImages = async () => {
    if (!blogData || images.length >= 6 || isGeneratingRemaining) return;
    setIsGeneratingRemaining(true);

    try {
      const currentImages = [...images];
      for (let i = images.length; i < 6; i++) {
        if (imagePrompts[i] || i < 6) {
          try {
            const prompt = imagePrompts[i] || generateImagePrompts()[i];
            const result = await generateImage(prompt);
            currentImages.push(result.imageData);
            if (result.isPlaceholder) {
              showToast('이미지 생성 서비스가 일시적으로 불가합니다. 임시 이미지로 대체됩니다.', 'error');
            }
          } catch {
            currentImages.push(`https://picsum.photos/seed/samsotta-body-${i}/1024/1024`);
            showToast('이미지 생성에 실패했습니다. 임시 이미지로 대체됩니다.', 'error');
          }
          setImages([...currentImages]);
        }
      }
    } catch {
      showToast('본문 이미지 생성에 실패했습니다.', 'error');
    } finally {
      setIsGeneratingRemaining(false);
    }
  };

  // ─── 클립보드 복사 ────────────────────────────────────────────────────────
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast('클립보드에 복사되었습니다!', 'success');
  };

  // ─── Google Docs 저장 ─────────────────────────────────────────────────────
  const handleSaveToDocs = async () => {
    if (!blogData || isSavingToDocs) return;
    setIsSavingToDocs(true);

    try {
      const res = await fetch('/api/docs/append', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: blogData.title,
          content: blogData.content
        })
      });

      const data = await res.json();

      if (res.ok) {
        showToast('Google Docs에 저장되었습니다! 🎉', 'success');
      } else if (res.status === 401 && data.needsAuth) {
        // 인증이 필요한 경우 OAuth 팝업 실행
        const urlRes = await fetch('/api/auth/google/url');
        const { url } = await urlRes.json();
        const popup = window.open(url, 'google_oauth', 'width=600,height=700');
        if (!popup) {
          showToast('팝업이 차단되었습니다. 팝업을 허용해 주세요.', 'error');
        } else {
          showToast('Google 인증 창이 열렸습니다.', 'info');
        }
      } else {
        showToast(data.error || '저장에 실패했습니다.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('네트워크 오류가 발생했습니다.', 'error');
    } finally {
      setIsSavingToDocs(false);
    }
  };

  // ─── 이미지 다운로드 ──────────────────────────────────────────────────────
  const downloadImage = async (idx: number, imgUrl: string) => {
    if (idx < 2) {
      const element = document.getElementById(`image-container-${idx}`);
      if (!element) return;

      const tag = element.querySelector<HTMLElement>('.image-tag');
      const overlay = element.querySelector<HTMLElement>('.download-overlay');

      tag && (tag.style.display = 'none');
      overlay && (overlay.style.display = 'none');

      try {
        const dataUrl = await toPng(element, {
          cacheBust: true,
          pixelRatio: 2,
          filter: (node) => {
            if (node.tagName === 'LINK' && (node as HTMLLinkElement).rel === 'stylesheet') {
              return (node as HTMLLinkElement).href.includes('fonts.googleapis.com') ||
                     (node as HTMLLinkElement).href.includes('jsdelivr.net');
            }
            return true;
          }
        });
        const link = document.createElement('a');
        link.download = `samsotta-thumbnail-${idx + 1}.png`;
        link.href = dataUrl;
        link.click();
      } catch (err) {
        console.error('이미지 저장 실패:', err);
        const link = document.createElement('a');
        link.download = `samsotta-thumbnail-${idx + 1}.png`;
        link.href = imgUrl;
        link.click();
      } finally {
        tag && (tag.style.display = 'block');
        overlay && (overlay.style.display = 'flex');
      }
    } else {
      const link = document.createElement('a');
      link.download = `samsotta-image-${idx + 1}.png`;
      link.href = imgUrl;
      link.click();
    }
  };

  const resetAll = () => {
    setBlogData(null);
    setFile(null);
    setImages([]);
    setThumbnailTitle('');
    setError(null);
  };

  // ─── 렌더링 ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-brand-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-brand-200">
              <Sparkles size={24} />
            </div>
            <h1 className="text-xl font-bold text-slate-900 font-subtitle">SAM.SOTTA</h1>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a href="https://www.samsotta.com/AI" target="_blank" rel="noopener noreferrer" className="hover:text-brand-600 transition-colors">서비스 소개</a>
            <a href={GOOGLE_DOC_URL} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-brand-600 transition-colors">
              <ExternalLink size={14} /> Google Docs
            </a>
            <a href="tel:02-6949-3501" className="bg-brand-50 text-brand-600 px-4 py-2 rounded-lg hover:bg-brand-100 transition-colors">
              문의하기
            </a>
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12">

        {/* ── 토스트 알림 ── */}
        <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center pointer-events-none">
          <AnimatePresence>
            {toasts.map(toast => (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className={cn(
                  "px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 font-bold text-white",
                  toast.type === 'success' && "bg-slate-900",
                  toast.type === 'error' && "bg-red-600",
                  toast.type === 'info' && "bg-brand-600"
                )}
              >
                {toast.type === 'success' && <CheckCircle2 size={20} className="text-green-400" />}
                {toast.type === 'error' && <AlertCircle size={20} className="text-red-200" />}
                {toast.type === 'info' && <Sparkles size={20} className="text-brand-200" />}
                {toast.message}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* ── 히어로 섹션 ── */}
        <div className="text-center mb-12">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl font-bold text-slate-900 mb-4 tracking-tight font-subtitle"
          >
            SAM.SOTTA<br />
            <span className="text-brand-600">제안서&프로그램 분석기</span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg text-slate-600"
          >
            제안서 업로드 → 분석 → 글작성 → 썸네일 & 이미지 생성
          </motion.p>
        </div>

        {/* ── 업로드 섹션 ── */}
        {!blogData && !isGenerating && !isParsing && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className={cn(
              "bg-white border-2 border-dashed rounded-3xl p-12 text-center transition-all",
              file ? "border-brand-400 bg-brand-50/30" : "border-slate-200 hover:border-brand-300"
            )}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
          >
            <div className="flex flex-col items-center gap-4">
              <div className={cn(
                "w-20 h-20 rounded-full flex items-center justify-center mb-2 transition-transform",
                file ? "bg-brand-100 text-brand-600 scale-110" : "bg-slate-100 text-slate-400"
              )}>
                {file ? <FileText size={40} /> : <Upload size={40} />}
              </div>

              {file ? (
                <div className="space-y-6 w-full max-w-md mx-auto">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                      <FileText size={16} /> 썸네일 타이틀 (이미지에 반영)
                    </label>
                    <input
                      type="text"
                      value={thumbnailTitle}
                      onChange={(e) => setThumbnailTitle(e.target.value)}
                      placeholder="예: 우리 조직에 맞는 AI 교육의 '진짜' 정답은?"
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none transition-all"
                    />
                  </div>

                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <p className="text-sm font-semibold text-slate-900 truncate">{file.name}</p>
                    <p className="text-xs text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>

                  <div className="flex gap-3 justify-center">
                    <button
                      onClick={() => { setFile(null); setThumbnailTitle(''); }}
                      className="px-6 py-3 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-colors"
                    >
                      다시 선택
                    </button>
                    <button
                      onClick={processProposal}
                      disabled={!thumbnailTitle.trim()}
                      className={cn(
                        "px-8 py-3 rounded-xl text-white font-semibold shadow-lg transition-all active:scale-95 flex items-center gap-2",
                        thumbnailTitle.trim()
                          ? "bg-brand-600 hover:bg-brand-700 shadow-brand-200"
                          : "bg-slate-300 cursor-not-allowed shadow-none"
                      )}
                    >
                      블로그 생성하기 <ArrowRight size={18} />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <p className="text-xl font-semibold text-slate-900">제안서 PDF를 여기에 드래그하세요</p>
                    <p className="text-slate-500">또는 클릭하여 파일을 선택하세요</p>
                  </div>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-4 px-6 py-2 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-colors"
                  >
                    파일 선택
                  </button>
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept=".pdf"
                    onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
                  />
                </>
              )}
            </div>
          </motion.div>
        )}

        {/* ── 로딩 상태 ── */}
        {(isParsing || isGenerating) && (
          <div className="bg-white rounded-3xl p-16 text-center shadow-xl shadow-slate-200/50 border border-slate-100">
            <div className="flex flex-col items-center gap-8">
              <div className="relative">
                <div className="w-24 h-24 border-4 border-brand-100 border-t-brand-500 rounded-full animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles className="text-brand-500 animate-pulse" size={32} />
                </div>
              </div>
              <div className="space-y-3">
                <AnimatePresence mode="wait">
                  <motion.p
                    key={loadingMsgIdx}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="text-2xl font-bold text-slate-900"
                  >
                    {LOADING_MESSAGES[loadingMsgIdx]}
                  </motion.p>
                </AnimatePresence>
                <p className="text-slate-500">잠시만 기다려 주시면 마법같은 결과가 나타납니다.</p>
              </div>
            </div>
          </div>
        )}

        {/* ── 에러 상태 ── */}
        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-red-50 border border-red-100 rounded-2xl p-6 flex items-start gap-4 text-red-700 mb-8"
          >
            <AlertCircle className="shrink-0 mt-1" />
            <div className="space-y-2">
              <p className="font-semibold">오류가 발생했습니다</p>
              <p className="text-sm opacity-90">{error}</p>
              <button
                onClick={resetAll}
                className="text-sm font-bold underline underline-offset-4"
              >
                처음부터 다시 시도
              </button>
            </div>
          </motion.div>
        )}

        {/* ── 결과 섹션 ── */}
        {blogData && (
          <div className="space-y-12">
            {/* 블로그 콘텐츠 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden"
            >
              <div className="p-8 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center text-white">
                    <FileText size={18} />
                  </div>
                  <h3 className="font-bold text-slate-900">생성된 블로그 포스팅</h3>
                </div>
                <button
                  onClick={() => copyToClipboard(`${blogData.title}\n\n${blogData.content}`)}
                  className="flex items-center gap-2 text-sm font-semibold text-brand-600 hover:text-brand-700 transition-colors"
                >
                  <Copy size={16} /> 전체 복사
                </button>
              </div>
              <div className="p-8 md:p-12">
                <h2 className="text-3xl font-bold text-slate-900 mb-8 leading-tight font-subtitle">
                  {blogData.title}
                </h2>
                <div className="markdown-body">
                  <ReactMarkdown>{blogData.content}</ReactMarkdown>
                </div>
              </div>
            </motion.div>

            {/* 이미지 섹션 */}
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center text-white">
                    <ImageIcon size={18} />
                  </div>
                  <h3 className="font-bold text-slate-900 text-xl font-subtitle">맞춤형 AI 이미지</h3>
                </div>
                <p className="text-sm text-slate-500">총 {images.length}장 생성됨</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {images.map((img, idx) => (
                  <motion.div
                    key={idx}
                    id={`image-container-${idx}`}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: idx * 0.1 }}
                    className="group relative bg-white rounded-2xl overflow-hidden shadow-md border border-slate-100"
                  >
                    <img
                      src={img}
                      alt={`Generated ${idx + 1}`}
                      className="w-full aspect-square object-cover"
                      referrerPolicy="no-referrer"
                    />

                    {/* 썸네일 텍스트 오버레이 */}
                    {idx < 2 && thumbnailTitle && (
                      <div className={cn(
                        "absolute inset-0 flex flex-col items-center justify-center p-8 text-center pointer-events-none",
                        idx === 0 ? "text-white" : "text-slate-900"
                      )}>
                        <div className={cn(
                          "px-4 py-1.5 rounded-full text-xs font-bold mb-4",
                          idx === 0
                            ? "bg-brand-500/20 text-brand-300 border border-brand-500/30"
                            : "bg-orange-100 text-orange-600 border border-orange-200"
                        )}>
                          {idx === 0 ? "AX 인사이트" : "몰입형 교육"}
                        </div>
                        <h4 className={cn(
                          "text-2xl md:text-3xl font-bold font-subtitle leading-tight break-keep",
                          idx === 0 ? "drop-shadow-[0_2px_10px_rgba(162,28,175,0.5)]" : ""
                        )}>
                          {thumbnailTitle}
                        </h4>
                        <div className={cn(
                          "mt-6 w-12 h-1 rounded-full",
                          idx === 0 ? "bg-brand-500" : "bg-orange-500"
                        )} />
                        <div className="absolute bottom-6 right-6 opacity-60 text-[10px] font-bold tracking-widest">
                          SAM.SOTTA
                        </div>
                      </div>
                    )}

                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3 download-overlay">
                      <button
                        onClick={() => downloadImage(idx, img)}
                        className="p-3 bg-white rounded-full text-slate-900 hover:bg-brand-50 transition-colors"
                        title="이미지 다운로드"
                      >
                        <Download size={20} />
                      </button>
                    </div>
                    <div className="absolute top-4 left-4 image-tag">
                      <span className="px-3 py-1 bg-white/90 backdrop-blur-sm rounded-full text-xs font-bold text-brand-600 shadow-sm">
                        {idx < 2 ? `THUMBNAIL ${idx + 1}` : `IMAGE ${idx - 1}`}
                      </span>
                    </div>
                  </motion.div>
                ))}

                {images.length < 6 && (isGenerating || isGeneratingRemaining) && (
                  <div className="aspect-square bg-slate-100 rounded-2xl flex flex-col items-center justify-center gap-4 border-2 border-dashed border-slate-200">
                    <Loader2 className="animate-spin text-brand-400" size={32} />
                    <p className="text-sm text-slate-500">다음 이미지 생성 중...</p>
                  </div>
                )}
              </div>

              {images.length === 2 && !isGeneratingRemaining && (
                <div className="flex justify-center pt-4">
                  <button
                    onClick={generateRemainingImages}
                    className="px-8 py-4 rounded-2xl bg-brand-100 text-brand-700 font-bold hover:bg-brand-200 transition-all flex items-center gap-2 shadow-sm"
                  >
                    <ImageIcon size={20} /> 본문 이미지 생성 (4장 추가)
                  </button>
                </div>
              )}
            </div>

            {/* 액션 버튼 */}
            <div className="flex flex-col md:flex-row gap-4 justify-center pt-8">
              <button
                onClick={resetAll}
                className="px-8 py-4 rounded-2xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw size={20} /> 다른 제안서 올리기
              </button>

              {isProduction ? (
                <button
                  onClick={handleSaveToDocs}
                  disabled={isSavingToDocs}
                  className="px-8 py-4 rounded-2xl bg-slate-900 text-white font-bold hover:bg-slate-800 shadow-xl shadow-slate-200 transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSavingToDocs ? (
                    <><Loader2 className="animate-spin" size={20} /> 저장 중...</>
                  ) : (
                    <><Save size={20} /> Google Docs에 저장</>
                  )}
                </button>
              ) : (
                <div className="px-8 py-4 rounded-2xl bg-slate-200 text-slate-500 font-bold flex items-center justify-center gap-2 cursor-not-allowed" title="Google Docs 저장은 Production 환경에서만 가능합니다.">
                  <Save size={20} /> Google Docs 저장 (Production 전용)
                </div>
              )}

              <a
                href={GOOGLE_DOC_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="px-8 py-4 rounded-2xl bg-brand-600 text-white font-bold hover:bg-brand-700 shadow-xl shadow-brand-200 transition-all flex items-center justify-center gap-2 active:scale-95"
              >
                <ExternalLink size={20} /> Google Docs 열기
              </a>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-12 mt-24">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-8 h-8 bg-slate-200 rounded-lg flex items-center justify-center text-slate-500">
              <Sparkles size={18} />
            </div>
            <span className="font-bold text-slate-900">SAM.SOTTA</span>
          </div>
          <p className="text-slate-500 text-sm">
            © 2014 SAM.SOTTA. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
