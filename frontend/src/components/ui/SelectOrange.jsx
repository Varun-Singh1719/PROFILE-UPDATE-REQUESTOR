import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import ChevronDown from "@mui/icons-material/KeyboardArrowDown";
import Check from "@mui/icons-material/Check";

/**
 * SelectOrange — a custom dropdown that always opens DOWNWARD below its
 * trigger and never overlaps adjacent fields. Replacement for native
 * <select> in places where the native popup behaviour (sometimes opens up,
 * cropped by parent overflow, blue native highlight on macOS, etc.) doesn't
 * match the application's design system.
 *
 * Why a Portal?
 *   The popup is rendered into document.body so it is never clipped by
 *   parent `overflow: hidden`, modals, or other layout containers. Position
 *   is recomputed on scroll/resize while open.
 *
 * Props:
 *   value           — currently selected option value (any)
 *   onChange(value) — called when user picks an option
 *   options         — Array of { value, label, sublabel?, disabled?, group? }
 *                     OR an Array of {label, items: options[]} for groups.
 *   placeholder     — string shown when no value is selected
 *   disabled        — disables the trigger
 *   searchable      — when true, shows a search box in the popup
 *   testIdPrefix    — for stable data-testid hooks
 */
export default function SelectOrange({
  value,
  onChange,
  options = [],
  placeholder = 'Select…',
  disabled = false,
  searchable = false,
  testIdPrefix = 'select',
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [popupRect, setPopupRect] = useState(null);
  const triggerRef = useRef(null);
  const popupRef = useRef(null);
  const searchRef = useRef(null);

  // Flatten options and remember which option corresponds to value.
  const flatOptions = useMemo(() => {
    const out = [];
    options.forEach((o) => {
      if (o && Array.isArray(o.items)) {
        out.push({ __group: true, label: o.label });
        o.items.forEach((it) => out.push(it));
      } else {
        out.push(o);
      }
    });
    return out;
  }, [options]);

  const selected = useMemo(
    () => flatOptions.find((o) => !o.__group && o.value === value),
    [flatOptions, value],
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return flatOptions;
    const q = query.trim().toLowerCase();
    return flatOptions.filter((o) => {
      if (o.__group) return false;
      return (
        String(o.label || '').toLowerCase().includes(q) ||
        String(o.sublabel || '').toLowerCase().includes(q)
      );
    });
  }, [flatOptions, query]);

  const recalc = useCallback(() => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPopupRect({
      top: r.bottom + window.scrollY + 4,
      left: r.left + window.scrollX,
      width: r.width,
    });
  }, []);

  // Helper: close popup AND clear search query in one go. Used from outside-
  // click, escape, and option-pick handlers so we avoid a "set-state in
  // effect" pattern that's flagged by react-hooks/set-state-in-effect.
  // Defined here BEFORE the effects below so the closure resolves correctly
  // (Temporal Dead Zone — a `const` cannot be referenced before its line).
  const closePopup = useCallback(() => {
    setOpen(false);
    setQuery('');
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

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (popupRef.current?.contains(e.target)) return;
      if (triggerRef.current?.contains(e.target)) return;
      closePopup();
    };
    const onKey = (e) => { if (e.key === 'Escape') closePopup(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, closePopup]);

  // Focus the search box when popup opens
  useEffect(() => {
    if (open && searchable) requestAnimationFrame(() => searchRef.current?.focus());
  }, [open, searchable]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        data-testid={`${testIdPrefix}-trigger`}
        className={[
          'w-full px-3 py-2 border rounded text-sm bg-white text-left',
          'flex items-center justify-between gap-2',
          'border-gray-300 focus:outline-none focus:border-[#ec9324]',
          open ? 'border-[#ec9324] ring-1 ring-[#ec9324]/30' : '',
          disabled ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : 'hover:border-[#ec9324]',
          className,
        ].join(' ')}
      >
        <span className={selected ? 'text-gray-900 truncate' : 'text-gray-400 truncate'}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown sx={{ fontSize: 14 }} className={`text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}/>
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
          {searchable && (
            <div className="p-2 border-b border-gray-100">
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                data-testid={`${testIdPrefix}-search`}
                className="w-full px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:border-[#ec9324]"
              />
            </div>
          )}
          <div className="max-h-60 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
            {filtered.length === 0 && (
              <div className="px-3 py-3 text-xs text-center text-gray-400">No options</div>
            )}
            {filtered.map((o, idx) => {
              if (o.__group) {
                return (
                  <div key={`g-${idx}`} className="px-3 py-1 text-[10px] uppercase tracking-wider text-gray-400 bg-gray-50 font-semibold">
                    {o.label}
                  </div>
                );
              }
              const isSel = o.value === value;
              return (
                <button
                  key={String(o.value)}
                  type="button"
                  disabled={o.disabled}
                  onClick={() => { onChange(o.value); closePopup(); }}
                  data-testid={`${testIdPrefix}-item-${o.value}`}
                  className={[
                    'w-full text-left px-3 py-1.5 text-sm flex items-center justify-between gap-2 transition-colors',
                    o.disabled ? 'text-gray-300 cursor-not-allowed' :
                      isSel
                        ? 'bg-[#ec9324] text-white'
                        : 'text-gray-800 hover:bg-[#fdf1e2] hover:text-[#ec9324]',
                  ].join(' ')}
                >
                  <span className="flex flex-col min-w-0 flex-1">
                    <span className="truncate font-medium">{o.label}</span>
                    {o.sublabel && (
                      <span className={`truncate text-[10px] ${isSel ? 'text-white/90' : 'text-gray-500'}`}>
                        {o.sublabel}
                      </span>
                    )}
                  </span>
                  {isSel && <Check sx={{ fontSize: 14 }} className="shrink-0"/>}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
