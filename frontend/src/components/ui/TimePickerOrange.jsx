import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Clock } from 'lucide-react';

/**
 * Orange-themed time picker (HH:MM in 24-hour internal format).
 *
 * Why custom instead of <input type="time">?
 *   Native time pickers in Chromium/Safari/Firefox render their own popup whose
 *   selected-value highlight is hard-coded to the system blue. We need the
 *   selected hour/minute highlighted in the app's orange (#ec9324), per UX
 *   spec. A custom popover gives full control of styling AND opens consistently
 *   downward below the input (rendered via Portal so it can never be clipped
 *   by parent overflow).
 *
 * Props:
 *   value          — 'HH:MM' string (24-hour internal). e.g. '10:00', '14:30'.
 *   onChange(value)— called with new 'HH:MM' string when user picks.
 *   minuteStep     — step for the minute column (default 5).
 *   format         — '12h' (default, shows AM/PM in input + AM/PM column) or '24h'.
 *   testIdPrefix   — used for stable data-testid hooks.
 *   disabled, placeholder, className — standard input behaviour.
 */
const ORANGE = '#ec9324';
const ORANGE_HOVER = '#f7b56c';

function toDisplay(value, format) {
  if (!value) return '';
  const [hStr, mStr] = value.split(':');
  const h = parseInt(hStr || '0', 10);
  const m = parseInt(mStr || '0', 10);
  if (format === '24h') {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
}

function parseValue(value) {
  if (!value) return { h: 10, m: 0 };
  const [hStr, mStr] = value.split(':');
  return {
    h: Math.max(0, Math.min(23, parseInt(hStr || '0', 10) || 0)),
    m: Math.max(0, Math.min(59, parseInt(mStr || '0', 10) || 0)),
  };
}

export default function TimePickerOrange({
  value,
  onChange,
  minuteStep = 5,
  format = '12h',
  disabled = false,
  placeholder = '--:--',
  className = '',
  testIdPrefix = 'time',
}) {
  const [open, setOpen] = useState(false);
  const [popupRect, setPopupRect] = useState(null); // { top, left, width }
  const triggerRef = useRef(null);
  const popupRef = useRef(null);

  const { h: hour, m: minute } = useMemo(() => parseValue(value), [value]);

  // Compute the popup position whenever it opens or the window resizes/scrolls.
  const recalc = useCallback(() => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPopupRect({
      top: r.bottom + window.scrollY + 4,
      left: r.left + window.scrollX,
      width: Math.max(220, r.width),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    recalc();
    window.addEventListener('scroll', recalc, true);
    window.addEventListener('resize', recalc);
    return () => {
      window.removeEventListener('scroll', recalc, true);
      window.removeEventListener('resize', recalc);
    };
  }, [open, recalc]);

  // Close on outside click / escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (popupRef.current?.contains(e.target)) return;
      if (triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Auto-scroll the highlighted hour/minute into view when opening.
  useEffect(() => {
    if (!open) return;
    const root = popupRef.current; if (!root) return;
    requestAnimationFrame(() => {
      root.querySelectorAll('[data-tp-selected="true"]').forEach((el) => {
        el.scrollIntoView({ block: 'center' });
      });
    });
  }, [open]);

  const pickHour = (h) => onChange(`${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  const pickMinute = (m) => onChange(`${String(hour).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  const pickPeriod = (period) => {
    const isPm = period === 'PM';
    const h12 = hour % 12;
    const newH = isPm ? (h12 === 0 ? 12 : h12 + 12) % 24 : (h12 === 0 ? 0 : h12);
    onChange(`${String(newH).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  };

  // Column data
  const hours = format === '12h'
    ? Array.from({ length: 12 }, (_, i) => (i === 0 ? 12 : i)) // 12, 1, 2, … 11
    : Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: Math.ceil(60 / minuteStep) }, (_, i) => i * minuteStep);
  const period = hour >= 12 ? 'PM' : 'AM';
  // selected hour mapping for 12h display
  const selectedHourCell = format === '12h'
    ? (hour % 12 === 0 ? 12 : hour % 12)
    : hour;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        data-testid={`${testIdPrefix}-trigger`}
        className={[
          'w-full px-2 py-1.5 border rounded text-sm bg-white text-left',
          'flex items-center justify-between gap-2',
          'border-gray-300 focus:outline-none focus:border-[#ec9324]',
          open ? 'border-[#ec9324] ring-1 ring-[#ec9324]/30' : '',
          disabled ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : 'hover:border-[#ec9324]',
          className,
        ].join(' ')}
      >
        <span className={value ? 'text-gray-900' : 'text-gray-400'}>
          {value ? toDisplay(value, format) : placeholder}
        </span>
        <Clock size={14} className="text-gray-400 shrink-0" />
      </button>

      {open && popupRect && createPortal(
        <div
          ref={popupRef}
          data-testid={`${testIdPrefix}-popup`}
          style={{
            position: 'absolute',
            top: popupRect.top,
            left: popupRect.left,
            width: popupRect.width,
            zIndex: 9999,
          }}
          className="bg-white border border-gray-200 rounded-md shadow-xl overflow-hidden"
        >
          <div className="grid" style={{ gridTemplateColumns: format === '12h' ? '1fr 1fr 60px' : '1fr 1fr' }}>
            {/* Hours */}
            <Column
              testId={`${testIdPrefix}-hours`}
              items={hours}
              selected={selectedHourCell}
              onPick={(h) => {
                if (format === '12h') {
                  // map clicked 12-hour label back to 24-hour internal
                  const isPm = period === 'PM';
                  const mapped = h === 12 ? (isPm ? 12 : 0) : (isPm ? h + 12 : h);
                  pickHour(mapped);
                } else {
                  pickHour(h);
                }
              }}
              label="Hour"
            />
            {/* Minutes */}
            <Column
              testId={`${testIdPrefix}-mins`}
              items={minutes}
              selected={minute - (minute % minuteStep)}
              onPick={pickMinute}
              label="Min"
            />
            {/* AM/PM (12h only) */}
            {format === '12h' && (
              <Column
                testId={`${testIdPrefix}-period`}
                items={['AM', 'PM']}
                selected={period}
                onPick={pickPeriod}
                label="AM/PM"
                isStringList
              />
            )}
          </div>
          <div className="border-t border-gray-100 flex justify-between items-center px-2 py-1.5 bg-gray-50">
            <span className="text-[10px] text-gray-500">Click a value to select</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              data-testid={`${testIdPrefix}-done`}
              className="text-[11px] font-semibold text-[#ec9324] hover:text-[#d4811f]"
            >Done</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function Column({ items, selected, onPick, label, isStringList, testId }) {
  return (
    <div className="border-r last:border-r-0 border-gray-100" data-testid={testId}>
      <div className="text-[10px] text-gray-500 text-center py-1 border-b border-gray-100 bg-gray-50 font-semibold">
        {label}
      </div>
      <div className="max-h-48 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
        {items.map((it) => {
          const isSelected = isStringList ? it === selected : it === selected;
          const text = isStringList ? it : String(it).padStart(2, '0');
          return (
            <button
              key={String(it)}
              type="button"
              onClick={() => onPick(it)}
              data-tp-selected={isSelected ? 'true' : 'false'}
              data-testid={`${testId}-item-${it}`}
              style={isSelected ? { backgroundColor: ORANGE, color: '#fff', boxShadow: `inset 0 0 0 1px ${ORANGE_HOVER}` } : undefined}
              className={[
                'w-full text-center text-sm py-1.5 transition-colors font-medium',
                isSelected
                  ? '' // colors set via inline style above
                  : 'text-gray-700 hover:bg-[#fdf1e2] hover:text-[#ec9324]',
              ].join(' ')}
            >
              {text}
            </button>
          );
        })}
      </div>
    </div>
  );
}
