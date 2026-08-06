/**
 * LinkSegmentationTab — Client Detail View → "Link Segmentation" tab.
 * ===================================================================
 * Two-panel mapping UI:
 *   • LEFT  — the master Level-1 segmentation categories of
 *             "Infollion Research" (searchable, selectable list).
 *   • RIGHT — for each Infollion Level-1 category, a dropdown box that
 *             shows the mapped client Level-1 segmentations as removable
 *             chips (single-colour orange / white). Clicking the box
 *             opens a checkbox picker of the client's Level-1 options.
 *
 * If the client has no Level-1 segmentation, each right box shows an
 * inline "No segmentation available" + "+ Add Segmentation" prompt that
 * behaves exactly like the Client Detail Add Segmentation button.
 *
 * Nothing is persisted until Save is clicked. Cancel reverts to the
 * last-saved mapping. Parent (ClientDetailPage) is notified of the dirty
 * state via onDirtyChange to guard tab switches / navigation.
 */
import React, {
  useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo,
  useRef, useState, forwardRef,
} from "react";
import { createPortal } from "react-dom";
import api, { formatApiError } from "../lib/api";
import notify from "../lib/notify";
import Plus from "@mui/icons-material/AddOutlined";
import Close from "@mui/icons-material/CloseOutlined";
import Search from "@mui/icons-material/SearchOutlined";
import ChevronRight from "@mui/icons-material/KeyboardArrowRight";
import ChevronDown from "@mui/icons-material/KeyboardArrowDown";
import Check from "@mui/icons-material/Check";
// ----- Category icons (resolved by keyword from the category name) -----
import IcAgri from "@mui/icons-material/AgricultureOutlined";
import IcCar from "@mui/icons-material/DirectionsCarOutlined";
import IcBank from "@mui/icons-material/AccountBalanceOutlined";
import IcSci from "@mui/icons-material/ScienceOutlined";
import IcBiz from "@mui/icons-material/BusinessCenterOutlined";
import IcBag from "@mui/icons-material/ShoppingBagOutlined";
import IcKitchen from "@mui/icons-material/KitchenOutlined";
import IcCart from "@mui/icons-material/ShoppingCartOutlined";
import IcFood from "@mui/icons-material/RestaurantOutlined";
import IcSchool from "@mui/icons-material/SchoolOutlined";
import IcEng from "@mui/icons-material/EngineeringOutlined";
import IcMed from "@mui/icons-material/MedicalServicesOutlined";
import IcComputer from "@mui/icons-material/ComputerOutlined";
import IcBio from "@mui/icons-material/BiotechOutlined";
import IcShip from "@mui/icons-material/LocalShippingOutlined";
import IcLayers from "@mui/icons-material/LayersOutlined";
import IcMovie from "@mui/icons-material/MovieOutlined";
import IcConstruction from "@mui/icons-material/ConstructionOutlined";
import IcGas from "@mui/icons-material/LocalGasStationOutlined";
import IcBolt from "@mui/icons-material/BoltOutlined";
import IcHome from "@mui/icons-material/HomeWorkOutlined";
import IcStore from "@mui/icons-material/StorefrontOutlined";
import IcChip from "@mui/icons-material/MemoryOutlined";
import IcTower from "@mui/icons-material/CellTowerOutlined";
import IcSocial from "@mui/icons-material/Diversity3Outlined";
import IcCategory from "@mui/icons-material/CategoryOutlined";

// Resolve a sensible icon from the category name using keyword matching.
// Order matters — more specific terms are checked first.
function getCategoryIcon(name) {
  const n = (name || "").toLowerCase();
  const has = (...keys) => keys.some((k) => n.includes(k));
  if (has("semiconductor")) return IcChip;
  if (has("information technology", "info tech", "software", "technology")) return IcComputer;
  if (has("telecom", "telecommunication")) return IcTower;
  if (has("oil", "gas")) return IcGas;
  if (has("metal", "mining")) return IcConstruction;
  if (has("life science", "biotech", "pharma")) return IcBio;
  if (has("health", "hospital", "medical")) return IcMed;
  if (has("logistic", "shipping", "transport", "supply chain")) return IcShip;
  if (has("engineering", "capital goods", "manufactur", "industrial")) return IcEng;
  if (has("education", "school", "learning")) return IcSchool;
  if (has("food", "beverage", "staples", "restaurant")) return IcFood;
  if (has("fmcg", "non-durable", "non durable")) return IcCart;
  if (has("durable", "appliance")) return IcKitchen;
  if (has("discretionary")) return IcBag;
  if (has("retail", "ecommerce", "e-commerce", "commerce")) return IcStore;
  if (has("media", "entertainment")) return IcMovie;
  if (has("real estate", "property")) return IcHome;
  if (has("utilit", "infrastructure", "power", "energy", "electric")) return IcBolt;
  if (has("public sector", "social", "government", "govt")) return IcSocial;
  if (has("commercial", "professional service", "consulting")) return IcBiz;
  if (has("chemical")) return IcSci;
  if (has("agricultur", "farm")) return IcAgri;
  if (has("automotive", "auto", "mobility", "vehicle")) return IcCar;
  if (has("bfsi", "bank", "financ", "insurance", "capital market")) return IcBank;
  if (has("material")) return IcLayers;
  if (has("consumer")) return IcBag;
  return IcCategory;
}

// Deep-equal for a mapping object { key: [names] }.
function mappingsEqual(a, b) {
  const ka = Object.keys(a || {}).filter((k) => (a[k] || []).length);
  const kb = Object.keys(b || {}).filter((k) => (b[k] || []).length);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const va = [...(a[k] || [])].sort();
    const vb = [...(b[k] || [])].sort();
    if (va.length !== vb.length) return false;
    for (let i = 0; i < va.length; i++) if (va[i] !== vb[i]) return false;
  }
  return true;
}

/* ============================================================
 * SegLinkMultiSelect — dropdown box with chips INSIDE (single
 * orange/white tone) + checkbox picker popup. Controlled-open.
 * ============================================================ */
function SegLinkMultiSelect({
  options = [], value = [], onChange, open, onOpenChange, onAddSegmentation, testIdPrefix,
}) {
  const [query, setQuery] = useState("");
  const boxRef = useRef(null);
  const popRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const tid = testIdPrefix;
  const hasOptions = options.length > 0;

  const place = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left, width: r.width });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const h = () => place();
    window.addEventListener("scroll", h, true);
    window.addEventListener("resize", h);
    return () => {
      window.removeEventListener("scroll", h, true);
      window.removeEventListener("resize", h);
    };
  }, [open, place]);

  // Outside-click / Esc close.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (boxRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      onOpenChange?.(false);
    };
    const onKey = (e) => { if (e.key === "Escape") onOpenChange?.(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  useEffect(() => { if (!open) setQuery(""); }, [open]);

  const toggle = (val) => {
    const set = new Set(value);
    if (set.has(val)) set.delete(val);
    else set.add(val);
    // preserve option order
    onChange?.(options.map((o) => o.value).filter((v) => set.has(v)));
  };
  const remove = (val) => onChange?.(value.filter((v) => v !== val));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const selectedOpts = useMemo(
    () => value.map((v) => options.find((o) => o.value === v)).filter(Boolean),
    [value, options]
  );

  // -------- Empty state (client has no L1 segmentation) --------
  if (!hasOptions) {
    return (
      <div
        className="w-full min-h-[42px] rounded-lg border border-dashed border-gray-200 bg-gray-50/60 px-3 py-2"
        data-testid={tid ? `${tid}-empty` : undefined}
      >
        <div className="text-xs text-gray-400">No segmentation available</div>
        <button
          type="button"
          onClick={onAddSegmentation}
          className="mt-0.5 inline-flex items-center gap-0.5 text-xs font-semibold text-[#ec9324] hover:underline"
          data-testid={tid ? `${tid}-add` : undefined}
        >
          <Plus sx={{ fontSize: 14 }} /> Add Segmentation
        </button>
      </div>
    );
  }

  return (
    <>
      <div
        ref={boxRef}
        onClick={() => onOpenChange?.(!open)}
        data-testid={tid ? `${tid}-trigger` : undefined}
        className={
          "w-full min-h-[42px] rounded-lg border bg-white px-2.5 py-1.5 flex items-start gap-2 cursor-pointer transition-colors " +
          (open ? "border-[#ec9324] ring-2 ring-[#ec9324]/20" : "border-gray-200 hover:border-gray-300")
        }
      >
        <div className="flex-1 min-w-0 flex flex-wrap gap-1.5 items-center min-h-[26px]">
          {selectedOpts.length === 0 ? (
            <span className="text-xs text-gray-400 py-1">Select segmentations...</span>
          ) : (
            selectedOpts.map((o) => (
              <span
                key={o.value}
                className="inline-flex items-center gap-1 rounded-md bg-orange-50 border border-[#ec9324]/40 text-[#ec9324] text-xs font-medium pl-2 pr-1 py-0.5 max-w-full"
                data-testid={tid ? `${tid}-chip-${o.value}` : undefined}
                title={o.label}
              >
                <span className="truncate">{o.label}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); remove(o.value); }}
                  aria-label={`Remove ${o.label}`}
                  className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-[#ec9324]/15"
                  data-testid={tid ? `${tid}-chip-remove-${o.value}` : undefined}
                >
                  <Close sx={{ fontSize: 11 }} />
                </button>
              </span>
            ))
          )}
        </div>
        <ChevronDown
          sx={{ fontSize: 20 }}
          className={"shrink-0 mt-1 text-gray-400 transition-transform " + (open ? "rotate-180" : "")}
        />
      </div>

      {open && createPortal(
        <div
          ref={popRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 60 }}
          className="bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden"
          data-testid={tid ? `${tid}-popup` : undefined}
        >
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search sx={{ fontSize: 16 }} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search..."
                className="w-full h-8 pl-7 pr-2 text-xs border border-gray-200 rounded-md outline-none focus:border-[#ec9324] focus:ring-2 focus:ring-[#ec9324]/20"
                data-testid={tid ? `${tid}-search` : undefined}
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-gray-400 text-center">No matches</div>
            ) : (
              filtered.map((o) => {
                const sel = value.includes(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => toggle(o.value)}
                    className={"w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors " + (sel ? "bg-orange-50" : "hover:bg-orange-50/60")}
                    data-testid={tid ? `${tid}-opt-${o.value}` : undefined}
                  >
                    <span
                      className={"shrink-0 w-4 h-4 rounded flex items-center justify-center border " + (sel ? "bg-[#ec9324] border-[#ec9324]" : "border-gray-300 bg-white")}
                    >
                      {sel && <Check sx={{ fontSize: 13 }} className="text-white" />}
                    </span>
                    <span className={"truncate " + (sel ? "text-[#ec9324] font-medium" : "text-gray-700")}>{o.label}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

/* ============================================================ */
const LinkSegmentationTab = forwardRef(function LinkSegmentationTab(
  { clientId, clientName, onDirtyChange, onSavingChange, onAddSegmentation },
  ref
) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [infollionL1, setInfollionL1] = useState([]);
  const [clientL1, setClientL1] = useState([]);
  const [infollionExists, setInfollionExists] = useState(true);

  const [saved, setSaved] = useState({});
  const [draft, setDraft] = useState({});
  const [catQuery, setCatQuery] = useState("");
  const [activeCat, setActiveCat] = useState(null);
  const [openCat, setOpenCat] = useState(null); // which row's dropdown is open

  const dirty = useMemo(() => !mappingsEqual(saved, draft), [saved, draft]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/clients/${clientId}/segmentation-link`);
      setInfollionL1(data?.infollion?.level1 || []);
      setInfollionExists(!!data?.infollion?.exists);
      setClientL1(data?.client_level1 || []);
      const m = data?.mappings || {};
      setSaved(m);
      setDraft(m);
    } catch (e) {
      notify.error(formatApiError(e, "Failed to load segmentation link"));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  // NOTE: no auto-refresh — data loads on mount / client change only.

  const updateRow = (key, values) => {
    setDraft((prev) => {
      const next = { ...prev };
      if (!values || values.length === 0) delete next[key];
      else next[key] = values;
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data } = await api.put(`/clients/${clientId}/segmentation-link`, { mappings: draft });
      const m = data?.mappings || {};
      setSaved(m);
      setDraft(m);
      notify.success("Segmentation mapping saved");
    } catch (e) {
      notify.error(formatApiError(e, "Failed to save mapping"));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => { setDraft(saved); setOpenCat(null); };

  // Report saving state upward so the parent's Save/Cancel (in the tab bar)
  // can disable while a save is in flight.
  useEffect(() => { onSavingChange?.(saving); }, [saving, onSavingChange]);

  useImperativeHandle(ref, () => ({
    discard: () => setDraft(saved),
    reload: () => load(),
    isDirty: () => dirty,
    save: handleSave,
    cancel: handleCancel,
  }));

  const clientOptions = useMemo(
    () => clientL1.map((n) => ({ value: n, label: n })),
    [clientL1]
  );

  const visibleCats = useMemo(() => {
    const q = catQuery.trim().toLowerCase();
    if (!q) return infollionL1;
    return infollionL1.filter((n) => n.toLowerCase().includes(q));
  }, [infollionL1, catQuery]);

  // ---------------- render ----------------
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden" data-testid="link-segmentation-tab">
      {loading ? (
        <div className="text-center py-16 text-sm text-gray-500">Loading…</div>
      ) : !infollionExists ? (
        <div className="text-center py-16 text-sm text-gray-500">
          The master “Infollion Research” segmentation was not found.
        </div>
      ) : (
        <div className="p-3 sm:p-4">
          <div className="rounded-xl border border-gray-200 overflow-hidden">
            <div className="h-[calc(100vh-172px)] overflow-y-auto">
              {/* ===== STICKY HEADERS ===== */}
              <div className="sticky top-0 z-20 bg-gray-50 border-b border-gray-200 shadow-sm">
                <div className="relative grid grid-cols-1 lg:grid-cols-2">
                  {/* Arrow badge between the two panels (desktop) */}
                  <div className="hidden lg:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
                    <div className="w-7 h-7 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-400">
                      <ChevronRight sx={{ fontSize: 18 }} />
                    </div>
                  </div>
                  {/* LEFT header */}
                  <div className="p-3 lg:pr-8 flex items-center justify-between gap-3 flex-wrap">
                    <div className="text-sm font-bold text-gray-900">Infollion Research</div>
                    <div className="relative flex-1 min-w-[150px] max-w-[220px]">
                      <Search sx={{ fontSize: 16 }} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        value={catQuery}
                        onChange={(e) => setCatQuery(e.target.value)}
                        placeholder="Search categories..."
                        className="w-full h-8 pl-8 pr-2 text-xs bg-white border border-gray-200 rounded-lg outline-none focus:border-[#ec9324] focus:ring-2 focus:ring-[#ec9324]/20"
                        data-testid="link-seg-cat-search"
                      />
                    </div>
                  </div>
                  {/* RIGHT header */}
                  <div className="p-3 lg:pl-8 lg:border-l border-gray-200 flex items-center justify-between gap-3 flex-wrap">
                    <div className="text-sm font-bold text-gray-900">{clientName}</div>
                    <div className="relative flex-1 min-w-[150px] max-w-[220px]">
                      <Search sx={{ fontSize: 16 }} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        value={catQuery}
                        onChange={(e) => setCatQuery(e.target.value)}
                        placeholder="Search segmentations..."
                        className="w-full h-8 pl-8 pr-2 text-xs bg-white border border-gray-200 rounded-lg outline-none focus:border-[#ec9324] focus:ring-2 focus:ring-[#ec9324]/20"
                        data-testid="link-seg-seg-search"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* ===== BODY (single grid → left/right cells share row height) ===== */}
              {visibleCats.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-400">
                  No categories match “{catQuery}”.
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2">
                {visibleCats.map((name, idx) => {
                  const Icon = getCategoryIcon(name);
                  const active = activeCat === name || openCat === name;
                  const isLast = idx === visibleCats.length - 1;
                  return (
                    <React.Fragment key={name}>
                      {/* LEFT cell — category pill */}
                      <div className={"lg:pr-8 px-3 py-2 " + (isLast ? "" : "")}>
                        <button
                          type="button"
                          onClick={() => { setActiveCat(name); setOpenCat(name); }}
                          data-testid={`link-seg-cat-${idx}`}
                          className={
                            "w-full flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors " +
                            (active
                              ? "bg-orange-50 border-[#ec9324] border-l-4 text-[#ec9324]"
                              : "bg-white border-gray-200 border-l-4 border-l-transparent text-gray-800 hover:border-gray-300")
                          }
                        >
                          <span className={"w-8 h-8 rounded-lg flex items-center justify-center shrink-0 " + (active ? "bg-[#ec9324]/15 text-[#ec9324]" : "bg-gray-100 text-gray-500")}>
                            <Icon sx={{ fontSize: 18 }} />
                          </span>
                          <span className="flex-1 min-w-0 truncate text-sm font-medium">{name}</span>
                          <ChevronRight sx={{ fontSize: 18 }} className={active ? "text-[#ec9324]" : "text-gray-300"} />
                        </button>
                      </div>
                      {/* RIGHT cell — dropdown box */}
                      <div className={"lg:pl-8 px-3 py-2 lg:border-l border-gray-100 " + (active ? "lg:bg-orange-50/30" : "")} data-testid={`link-seg-row-${idx}`}>
                        <SegLinkMultiSelect
                          options={clientOptions}
                          value={draft[name] || []}
                          onChange={(v) => updateRow(name, v)}
                          open={openCat === name}
                          onOpenChange={(o) => setOpenCat(o ? name : null)}
                          onAddSegmentation={onAddSegmentation}
                          testIdPrefix={`link-seg-select-${idx}`}
                        />
                      </div>
                    </React.Fragment>
                  );
                })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default LinkSegmentationTab;
