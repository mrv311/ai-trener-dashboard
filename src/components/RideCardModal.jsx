import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Download, Copy, Check, Share2, Image as ImageIcon } from 'lucide-react';
import { UI_THEMES } from '../utils/themeConfig';
import { useI18n } from '../i18n/I18nContext';
import {
  RIDE_CARD_HEIGHT,
  RIDE_CARD_WIDTH,
  buildRideCardFilename,
  canvasToPngBlob,
  copyRideCardToClipboard,
  downloadRideCardPng,
  getActiveThemeAccentHex,
  renderRideCardToCanvas
} from '../utils/rideCardGenerator';

export default function RideCardModal({ isOpen, onClose, payload }) {
  const { lang, tr } = useI18n();
  const canvasRef = useRef(null);

  const [accentHex, setAccentHex] = useState(() => getActiveThemeAccentHex());
  const [cardLang, setCardLang] = useState(() => (lang === 'hr' ? 'hr' : 'en'));
  const [showHr, setShowHr] = useState(true);
  const [showEfficiency, setShowEfficiency] = useState(true);
  const [copyStatus, setCopyStatus] = useState('idle'); // 'idle' | 'copied' | 'error'
  const [downloadDone, setDownloadDone] = useState(false);

  // Kad se modal otvori, sinkroniziraj temu s aktivnom UI temom
  useEffect(() => {
    if (isOpen) {
      setAccentHex(getActiveThemeAccentHex());
      setCopyStatus('idle');
      setDownloadDone(false);
    }
  }, [isOpen]);

  const hasHrStream = useMemo(() => {
    const stream = payload?.stream;
    if (!Array.isArray(stream) || stream.length === 0) return false;
    return stream.some((pt) => Number(pt?.hr ?? pt?.heartrate ?? 0) > 35);
  }, [payload?.stream]);

  const canNativeShare = useMemo(() => {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof File === 'undefined') {
      return false;
    }
    try {
      const probe = new File([new Uint8Array(1)], 'card.png', { type: 'image/png' });
      return typeof navigator.canShare === 'function' ? navigator.canShare({ files: [probe] }) : false;
    } catch {
      return false;
    }
  }, []);

  // Crtaj karticu na Canvas pri svakoj promjeni opcija (+ ponovno nakon učitavanja fontova)
  useEffect(() => {
    if (!isOpen || !payload || !canvasRef.current) return;

    const draw = () => {
      if (!canvasRef.current) return;
      renderRideCardToCanvas(canvasRef.current, payload, {
        accentHex,
        lang: cardLang,
        showHr: showHr && hasHrStream,
        showEfficiency
      });
    };

    draw();
    let cancelled = false;
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (!cancelled) draw();
      });
    }
    return () => {
      cancelled = true;
    };
  }, [isOpen, payload, accentHex, cardLang, showHr, hasHrStream, showEfficiency]);

  if (!isOpen || !payload) return null;

  const filename = buildRideCardFilename(payload.title, payload.date);

  const handleDownload = async () => {
    try {
      await downloadRideCardPng(canvasRef.current, filename);
      setDownloadDone(true);
      setTimeout(() => setDownloadDone(false), 2500);
    } catch (err) {
      console.error('[RideCardModal] Download error:', err);
    }
  };

  const handleCopy = async () => {
    try {
      await copyRideCardToClipboard(canvasRef.current);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2500);
    } catch (err) {
      console.warn('[RideCardModal] Clipboard copy fallback:', err);
      setCopyStatus('error');
      setTimeout(() => setCopyStatus('idle'), 3000);
    }
  };

  const handleShare = async () => {
    try {
      const blob = await canvasToPngBlob(canvasRef.current);
      const file = new File([blob], filename, { type: 'image/png' });
      await navigator.share({
        title: payload.title || 'ErgVibe Ride Card',
        text: `${payload.title || 'Indoor Ride'} · ergvibe.vercel.app`,
        files: [file]
      });
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.warn('[RideCardModal] Native share error:', err);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center p-3 md:p-6 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={tr('Strava Ride Card pregled', 'Strava Ride Card Preview')}
    >
      <div
        className="carbon-panel rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[94dvh] animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-950 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-lg bg-volt-400/12 border border-volt-400/30 text-volt-400 shrink-0">
              <ImageIcon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm md:text-base font-display font-bold uppercase tracking-wide text-zinc-100 truncate">
                {tr('Strava Ride Card', 'Strava Ride Card')}
              </h3>
              <p className="text-[11px] font-mono text-zinc-500">
                1200×900 PNG · {tr('Spremno za objavu', 'Ready to share')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={tr('Zatvori', 'Close')}
            className="p-2 text-zinc-400 hover:text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg border border-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 md:p-5 space-y-4 overflow-y-auto custom-scrollbar">
          {/* Controls bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-zinc-950/90 border border-zinc-800 rounded-xl px-3.5 py-2.5">
            {/* Theme swatches */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500 mr-1">
                {tr('Akcent', 'Accent')}
              </span>
              {UI_THEMES.map((t) => {
                const isSelected = accentHex.toLowerCase() === t.swatch.toLowerCase();
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setAccentHex(t.swatch)}
                    title={t.name}
                    aria-label={t.name}
                    className={`w-5 h-5 rounded-full transition-transform hover:scale-110 ${
                      isSelected ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-950 scale-105' : 'opacity-70 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: t.swatch }}
                  />
                );
              })}
            </div>

            {/* Toggles + Card Language */}
            <div className="flex flex-wrap items-center gap-3 text-xs">
              {hasHrStream && (
                <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer select-none font-mono text-[11px]">
                  <input
                    type="checkbox"
                    checked={showHr}
                    onChange={(e) => setShowHr(e.target.checked)}
                    className="accent-volt-400 rounded"
                  />
                  <span>{tr('HR linija', 'HR line')}</span>
                </label>
              )}

              <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer select-none font-mono text-[11px]">
                <input
                  type="checkbox"
                  checked={showEfficiency}
                  onChange={(e) => setShowEfficiency(e.target.checked)}
                  className="accent-volt-400 rounded"
                />
                <span>EF &amp; Pw:HR</span>
              </label>

              <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 font-mono text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => setCardLang('en')}
                  className={`px-2 py-0.5 rounded-md transition-colors ${
                    cardLang === 'en' ? 'bg-volt-400 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  EN
                </button>
                <button
                  type="button"
                  onClick={() => setCardLang('hr')}
                  className={`px-2 py-0.5 rounded-md transition-colors ${
                    cardLang === 'hr' ? 'bg-volt-400 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  HR
                </button>
              </div>
            </div>
          </div>

          {/* Live Canvas Preview */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-2 flex items-center justify-center">
            <canvas
              ref={canvasRef}
              width={RIDE_CARD_WIDTH}
              height={RIDE_CARD_HEIGHT}
              className="w-full max-w-[580px] aspect-[4/3] rounded-lg block shadow-xl"
            />
          </div>

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              onClick={handleDownload}
              className="flex-[2] flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-volt-400 hover:bg-volt-300 text-zinc-950 font-display font-bold uppercase tracking-wider text-xs md:text-sm shadow-volt-glow transition-all"
            >
              {downloadDone ? <Check className="w-4 h-4" /> : <Download className="w-4 h-4" />}
              {downloadDone
                ? tr('Kartica preuzeta!', 'Card Downloaded!')
                : tr('Preuzmi .PNG karticu', 'Download .PNG Card')}
            </button>

            <button
              type="button"
              onClick={handleCopy}
              className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-zinc-950 hover:bg-zinc-900 text-zinc-200 border border-zinc-800 hover:border-zinc-700 font-mono font-bold uppercase tracking-wider text-xs transition-all"
            >
              {copyStatus === 'copied' ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-400">{tr('Kopirano!', 'Copied!')}</span>
                </>
              ) : copyStatus === 'error' ? (
                <span className="text-amber-400">{tr('Koristi Preuzmi', 'Use Download')}</span>
              ) : (
                <>
                  <Copy className="w-4 h-4 text-zinc-400" />
                  <span>{tr('Kopiraj sliku', 'Copy Image')}</span>
                </>
              )}
            </button>

            {canNativeShare && (
              <button
                type="button"
                onClick={handleShare}
                className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-zinc-950 hover:bg-zinc-900 text-volt-400 border border-volt-400/35 font-mono font-bold uppercase tracking-wider text-xs transition-all"
              >
                <Share2 className="w-4 h-4" />
                <span>{tr('Podijeli', 'Share')}</span>
              </button>
            )}
          </div>

          <p className="text-[11px] text-zinc-500 text-center font-mono">
            {tr(
              'Priloži preuzetu sliku ručno na svoju vožnju u Strava aplikaciji (ili zalijepi u poruku).',
              'Attach the downloaded PNG manually to your activity in the Strava app (or paste anywhere).'
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
