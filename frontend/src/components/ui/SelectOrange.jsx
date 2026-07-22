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
 * Two visual variants:
 *   • variant="button" (default)  — Trigger looks like a button showing the
 *     selected label; popup optionally has a search input at the top when
 *     `searchable` is true.
 *   • variant="typeable"          — Trigger IS the search input. As the user
 *     types, the popup opens automatically and filters the option list
 *     inline. The popup itself has NO separate search box. Selecting an
 *     option puts its label into the input.
 *
 * Options may specify:
 *   value, label, sublabel?, right?, searchExtra?, disabled?
 *   - `right`         → text rendered right-aligned inside the option row
 *                       (e.g. "14 Seats"). When set, the option layout
 *                       becomes: [label — flex 1, truncate] [right — shrink 0].
 *   - `searchExtra`   → additional text matched by the search filter but
 *                       NOT displayed anywhere (e.g. user's email that we
 *                       want to be searchable while showing only name).
 *
 * Why a Portal?
 *   The popup is rendered into document.body so it is never clipped by
 *   parent `overflow: hidden`, modals, or other layout containers. Position
 *   is recomputed on scroll/resize while open.
 */
export default function SelectOrange({
  value,
  onChange,
  options = [],
  placeholder = 'Select…',
  disabled = false,
  searchable = false,
  variant = 'button', // 'button' | 'typeable'
  testIdPrefix = 'select',
  className = '',
}) {
  const isTypeable = variant === 'typeable';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [popupRect, setPopupRect] = useState(null);
  const triggerRef = useRef(null);
  const inputRef = useRef(null);
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

  // For typeable variant: input shows the current query while typing, and
  // reverts to the selected label when the popup is closed and the user
  // hasn't typed anything different.
  const [inputText, setInputText] = useState(selected ? selected.label : '');
  useEffect(() => {
    if (!open) setInputText(selected ? selected.label : '');
  }, [selected, open]);

  // The effective search string used to filter options.
  const activeQuery = isTypeable ? inputText : query;

  const filtered = useMemo(() => {
    if (!activeQuery || !activeQuery.trim()) return flatOptions;
    // In typeable mode, once a value is picked and the input still equals
    // the selected label, we should show ALL options (not just the one
    // matching the current selection). That way clicking the field lets
    // the user browse again.
    if (isTypeable && selected && activeQuery === selected.label) {
      return flatOptions;
    }
    const q = activeQuery.trim().toLowerCase();
    return flatOptions.filter((o) => {
      if (o.__group) return false;
      return (
        String(o.label || '').toLowerCase().includes(q) ||
        String(o.sublabel || '').toLowerCase().includes(q) ||
        String(o.right || '').toLowerCase().includes(q) ||
        String(o.searchExtra || '').toLowerCase().includes(q)
      );
    });
  }, [flatOptions, activeQuery, isTypeable, selected]);

  const recalc = useCallback(() => {
    const anchor = isTypeable ? inputRef.current : triggerRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    setPopupRect({
      top: r.bottom + window.scrollY + 4,
      left: r.left + window.scrollX,
      width: r.width,
    });
  }, [isTypeable]);

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
      if (inputRef.current?.contains(e.target)) return;
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

  // Button variant: focus the search box when popup opens (if searchable).
  useEffect(() => {
    if (open && searchable && !isTypeable) requestAnimationFrame(() => searchRef.current?.focus());
  }, [open, searchable, isTypeable]);

  // ── Typeable trigger ────────────────────────────────────────────────
  const typeableTrigger = (
    <div
      ref={triggerRef}
      className={[
        'w-full px-3 py-2 border rounded text-sm bg-white',
        'flex items-center justify-between gap-2',
        'border-gray-300 focus-within:border-[#ec9324] focus-within:ring-1 focus-within:ring-[#ec9324]/30',
        open ? 'border-[#ec9324] ring-1 ring-[#ec9324]/30' : '',
        disabled ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : 'hover:border-[#ec9324]',
        className,
      ].join(' ')}
      onMouseDown={(e) => {
        // Prevent the outside-click handler from firing on the mousedown
        // that happens as we click into our own input area.
        if (e.target !== inputRef.current) e.preventDefault();
        if (!disabled) {
          setOpen(true);
          inputRef.current?.focus();
        }
      }}
    >
      <input
        ref={inputRef}
        type="text"
        disabled={disabled}
        value={inputText}
        placeholder={placeholder}
        data-testid={`${testIdPrefix}-input`}
        onChange={(e) => {
          setInputText(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => { if (!disabled) setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { closePopup(); inputRef.current?.blur(); }
          if (e.key === 'ArrowDown' && !open) setOpen(true);
        }}
        className="flex-1 min-w-0 bg-transparent outline-none placeholder:text-gray-400 text-gray-900"
      />
      <ChevronDown
        sx={{ fontSize: 14 }}
        className={`text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
      />
    </div>
  );

  // ── Button trigger (existing behaviour) ─────────────────────────────
  const buttonTrigger = (
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
  );

  return (
    <>
      {isTypeable ? typeableTrigger : buttonTrigger}

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
          {searchable && !isTypeable && (
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
              const hasRight = o.right !== undefined && o.right !== null && o.right !== '';
              return (
                <button
                  key={String(o.value)}
                  type="button"
                  disabled={o.disabled}
                  // Use onMouseDown so the click fires BEFORE the input's
                  // blur handler (which would close the popup) in the
                  // typeable variant.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (o.disabled) return;
                    onChange(o.value);
                    setInputText(o.label);
                    closePopup();
                  }}
                  data-testid={`${testIdPrefix}-item-${o.value}`}
                  className={[
                    'w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors',
                    hasRight ? 'justify-between' : 'justify-between',
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
                  {hasRight ? (
                    <span
                      className={`shrink-0 text-[12px] font-semibold tabular-nums ${isSel ? 'text-white' : 'text-gray-600'}`}
                      data-testid={`${testIdPrefix}-item-${o.value}-right`}
                    >
                      {o.right}
                    </span>
                  ) : (
                    isSel && <Check sx={{ fontSize: 14 }} className="shrink-0"/>
                  )}
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
