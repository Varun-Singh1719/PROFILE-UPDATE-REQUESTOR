import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import CenterFocusStrong from "@mui/icons-material/CenterFocusStrong";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import UnfoldLessIcon from "@mui/icons-material/UnfoldLess";

// Toolbar icon button — matches the Notification Bell visual pattern:
// pill-shaped hover target, dark tooltip that fades in on hover, orange
// text/tint when the cursor is on the button. Defined at module scope
// (outside CollapsibleTree) so React doesn't re-create the component
// type on every parent render.
//
// The tooltip is portalled OUT of the panel (positioned to the LEFT of
// the button) so the panel's rounded corners + subtle border don't need
// `overflow-hidden` — which would clip the tooltip.
const ToolButton = ({ onClick, icon, label, testid, position, active = false }) => {
  // position ∈ { "top", "middle", "bottom", "solo" } — used to round
  // the outer corners of the first / last button so the panel keeps
  // its rounded-lg outline without needing overflow-hidden.
  const round =
    position === "top" ? "rounded-t-lg" :
    position === "bottom" ? "rounded-b-lg" :
    position === "solo" ? "rounded-lg" : "";
  const divider = position === "bottom" || position === "solo"
    ? ""
    : "border-b border-white/50";
  const base = active
    ? "text-[#ec9324] bg-[#ec9324]/15"
    : "text-gray-700 hover:text-[#ec9324] hover:bg-white/60";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      data-testid={testid}
      className={
        "group relative inline-flex items-center justify-center " +
        "w-9 h-9 transition-colors " +
        `${base} ${round} ${divider}`
      }
    >
      {icon}
      {/* Tooltip — Notification-Bell pattern (dark pill, fade-in on
          group-hover). Positioned to the LEFT of the button (right-full)
          because the toolbar sits on the RIGHT edge of the canvas —
          tooltip going right would clip against the viewport. */}
      <span
        className="pointer-events-none absolute right-full mr-2 top-1/2 -translate-y-1/2
                   px-2 py-1 bg-gray-900 text-white text-[11px] font-medium
                   rounded whitespace-nowrap opacity-0 group-hover:opacity-100
                   transition-opacity duration-150 z-50 shadow-lg"
      >
        {label}
      </span>
    </button>
  );
};

/**
 * CollapsibleTree — React wrapper around the classic
 * https://observablehq.com/@d3/collapsible-tree example, with INLINE
 * on-canvas node creation (no modal at all).
 *
 * Interactions (editable=true):
 *   • Click a node's label → select it (blue ring). If it's Level 2+ a
 *     BLUE "+ Sibling" chip appears below the node.  All selected nodes
 *     (including root) get an ORANGE "+ Sub-Segment" chip after the label.
 *   • Click "+ Sub-Segment" → a new empty node is inserted right there and the
 *     cursor lands INSIDE a text input rendered on that node (via SVG
 *     foreignObject). Enter = commit, blur = commit, Esc/blank = cancel
 *     (removes the placeholder). NO popup, no modal.
 *   • Click "+ Sibling" → same, but the new node is inserted as a sibling
 *     below the selected node.
 *   • Double-click a label → same inline editor, prepopulated with the
 *     current name (rename).
 *   • Click a node's ORANGE circle → collapse/expand its subtree.
 */
export default function CollapsibleTree({
  data,
  onChange,
  editable = false,
  onEditableToggle,
  defaultExpandDepth = Infinity,
  showToolbar = true,
  // When true, the root node (Level 1) starts SELECTED so its "+ Add
  // sub-segment" control is immediately visible/ready (used for the new
  // unsaved segmentation draft editor).
  autoSelectRoot = false,
}) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const selectedIdRef = useRef(autoSelectRoot ? 0 : null);
  const zoomBehaviorRef = useRef(null);
  const didInitialFitRef = useRef(false);
  const fitToViewRef = useRef(null); // set inside useLayoutEffect
  // Last-known cursor position over the SVG (in SVG pixel coords). Used
  // to make the toolbar Zoom In / Zoom Out buttons zoom around the point
  // the user is looking at, not the abstract centre of the canvas.
  const lastCursorRef = useRef(null);
  // Bound inside useLayoutEffect; called from toolbar buttons and the "F"
  // keyboard shortcut so we always use the latest hierarchy.
  const focusNodeRef = useRef(null);
  const zoomAtPointRef = useRef(null); // (kFactor: number) => void
  // Bound inside useLayoutEffect; called from toolbar buttons for the
  // Collapse All / Expand All actions. They mutate the current d3
  // hierarchy in-place (like the toggle click on a node) and re-run
  // update() so the zoom transform (k, x, y) is fully preserved — the
  // viewport does not jump / recenter, matching the spec.
  const collapseAllRef = useRef(null);
  const expandAllRef = useRef(null);
  // Tracks whether the user has manually zoomed / panned since the last
  // fresh mount. Used to decide whether to auto-refit on container
  // resize (e.g. the flex layout finishing settling after we navigate
  // back to the page): before any interaction we refit so the tree is
  // always centred; after the user has moved the viewport we preserve
  // their pan/zoom.
  const hasUserInteractedRef = useRef(false);

  // Local mirror of the incoming `data` — we mutate this scratchpad on
  // every add / rename / cancel, and only sync back to the parent via
  // onChange after each committed action. Sorted A → Z from the outset.
  const [viewData, setViewData] = useState(() => {
    if (!data) return { name: "", children: [] };
    const cloned = JSON.parse(JSON.stringify(data));
    // Inline sort — sortDeep is declared further down but hoists via
    // function scope only for `function` declarations, so we inline the
    // sort here to keep the initial render alphabetical.
    const sort = (node) => {
      if (!node || !Array.isArray(node.children)) return;
      node.children.sort((a, b) => {
        const an = (a?.name || "").trim();
        const bn = (b?.name || "").trim();
        if (!an && bn) return 1;
        if (an && !bn) return -1;
        return an.toLowerCase().localeCompare(bn.toLowerCase());
      });
      node.children.forEach(sort);
    };
    sort(cloned);
    return cloned;
  });

  // Whenever the parent hands us a new `data` prop we reset the local
  // scratchpad and drop any in-flight edit. The incoming tree is
  // alphabetically sorted so the view is A → Z from the very first
  // render (Aug 2026 requirement).
  useEffect(() => {
    if (data) {
      const cloned = JSON.parse(JSON.stringify(data));
      sortDeep(cloned);
      setViewData(cloned);
      setEditingPath(null);
      // A brand-new dataset should get a fresh initial fit AND treat the
      // canvas as un-touched (so the ResizeObserver auto-refits while
      // the flex layout settles).
      didInitialFitRef.current = false;
      hasUserInteractedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Path (array of children indices) of the currently-editing node.
  // null → nothing being edited.
  const [editingPath, setEditingPath] = useState(null);

  // -------------------------------------------- helpers
  const deepClone = (o) => JSON.parse(JSON.stringify(o));

  // Sort every level's children alphabetically (A → Z, case-insensitive).
  // Nodes with a blank name (freshly-inserted placeholders being edited
  // inline) are kept at the END of their group so the on-canvas editor
  // doesn't jump around while the user is still typing.
  const sortDeep = (node) => {
    if (!node || !Array.isArray(node.children)) return node;
    node.children.sort((a, b) => {
      const an = (a?.name || "").trim();
      const bn = (b?.name || "").trim();
      // Blank names sink to the bottom so an in-flight rename doesn't
      // shuffle the layout mid-keystroke.
      if (!an && bn) return 1;
      if (an && !bn) return -1;
      return an.toLowerCase().localeCompare(bn.toLowerCase());
    });
    node.children.forEach(sortDeep);
    return node;
  };

  // Locate the index of a freshly-inserted (blank-name) child inside a
  // just-sorted parent. sortDeep parks blank entries at the end, so this
  // returns the LAST-index blank child.
  const indexOfBlankChild = (parent) => {
    if (!parent?.children?.length) return -1;
    for (let i = parent.children.length - 1; i >= 0; i--) {
      if (!(parent.children[i]?.name || "").trim()) return i;
    }
    return -1;
  };

  const pathOfHNode = (h) => {
    // Walk up the d3.hierarchy node, computing the child index at each
    // step by looking up `n.data` inside `n.parent.data.children`.
    const path = [];
    let n = h;
    while (n && n.parent) {
      const idx = (n.parent.data.children || []).indexOf(n.data);
      if (idx < 0) return null;
      path.unshift(idx);
      n = n.parent;
    }
    return path;
  };

  const findByPath = (root, path) => {
    let n = root;
    for (const i of path) {
      if (!n?.children || !n.children[i]) return null;
      n = n.children[i];
    }
    return n;
  };

  const pathsEqual = (a, b) => {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };

  // Strip a tree of any local-only fields (currently nothing; kept for
  // future-proofing if we add __uid etc.) before emitting to the parent.
  const emit = useCallback(
    (tree) => onChange?.(deepClone(tree)),
    [onChange]
  );

  // -------------------------------------------- action handlers
  const startAddChild = useCallback((hNode) => {
    const targetPath = pathOfHNode(hNode);
    if (!targetPath) return;
    setViewData((prev) => {
      const next = deepClone(prev);
      const t = targetPath.length === 0 ? next : findByPath(next, targetPath);
      if (!t) return prev;
      t.children = Array.isArray(t.children) ? t.children : [];
      t.children.push({ name: "" });
      sortDeep(next);
      // Blank child sinks to the end after sort — locate it and set the
      // inline editor path to that position.
      const parent = targetPath.length === 0 ? next : findByPath(next, targetPath);
      const blankIdx = indexOfBlankChild(parent);
      if (blankIdx >= 0) {
        setEditingPath([...targetPath, blankIdx]);
      }
      return next;
    });
  }, []);

  const startAddPeer = useCallback((hNode) => {
    const targetPath = pathOfHNode(hNode);
    if (!targetPath || targetPath.length === 0) return;
    const parentPath = targetPath.slice(0, -1);
    setViewData((prev) => {
      const next = deepClone(prev);
      const parent = parentPath.length === 0 ? next : findByPath(next, parentPath);
      if (!parent) return prev;
      parent.children = Array.isArray(parent.children) ? parent.children : [];
      parent.children.push({ name: "" });
      sortDeep(next);
      // Same trick — blank sibling parked at end, so locate its position
      // and route the inline editor there.
      const refreshedParent =
        parentPath.length === 0 ? next : findByPath(next, parentPath);
      const blankIdx = indexOfBlankChild(refreshedParent);
      if (blankIdx >= 0) {
        setEditingPath([...parentPath, blankIdx]);
      }
      return next;
    });
  }, []);

  const startRename = useCallback((hNode) => {
    const p = pathOfHNode(hNode);
    if (!p) return;
    setEditingPath(p);
  }, []);

  // Delete-confirmation dialog state.
  // `pendingDelete` = { hNode, path, name, subCount } | null.
  const [pendingDelete, setPendingDelete] = useState(null);

  // Count all descendants of a node (used in the delete confirmation
  // message: "Do you wanna proceed with Deleting X & its N sub-segments?").
  const countDescendants = (n) => {
    if (!n || !Array.isArray(n.children)) return 0;
    let c = n.children.length;
    n.children.forEach((k) => { c += countDescendants(k); });
    return c;
  };

  const requestDelete = useCallback((hNode) => {
    const p = pathOfHNode(hNode);
    if (!p || p.length === 0) return; // never delete the root
    setPendingDelete({
      path: p,
      name: hNode?.data?.name || "",
      subCount: countDescendants(hNode?.data),
    });
  }, []);

  const cancelDelete = useCallback(() => setPendingDelete(null), []);
  const confirmDelete = useCallback(() => {
    setPendingDelete((current) => {
      if (!current) return null;
      const { path } = current;
      setViewData((prev) => {
        const next = deepClone(prev);
        const parentPath = path.slice(0, -1);
        const idx = path[path.length - 1];
        const parent =
          parentPath.length === 0 ? next : findByPath(next, parentPath);
        if (parent && Array.isArray(parent.children)) {
          parent.children.splice(idx, 1);
          if (parent.children.length === 0) delete parent.children;
        }
        sortDeep(next);
        emit(next);
        return next;
      });
      selectedIdRef.current = null;
      return null;
    });
  }, [emit]);

  // commit / cancel are called from within the D3-managed input's event
  // handlers. They MUST rebuild via `setViewData(prev => …)` so we always
  // work off the freshest scratchpad.
  const commitEdit = useCallback((value) => {
    const trimmed = (value || "").trim();
    setViewData((prev) => {
      // Snapshot path via functional access to keep refs current.
      return prev;
    });
    // Use the ref-latest path — read via a functional set:
    setEditingPath((path) => {
      if (!path) return null;
      if (!trimmed) {
        // Blank commit → treat as cancel (may remove a placeholder).
        setViewData((prev) => {
          const next = deepClone(prev);
          const node = findByPath(next, path);
          if (node && (!node.name || !node.name.trim())) {
            const parentPath = path.slice(0, -1);
            const idx = path[path.length - 1];
            const parent =
              parentPath.length === 0 ? next : findByPath(next, parentPath);
            if (parent && Array.isArray(parent.children)) {
              parent.children.splice(idx, 1);
              if (parent.children.length === 0) delete parent.children;
            }
          }
          // Fire onChange to persist the removal too.
          emit(next);
          return next;
        });
        return null;
      }
      setViewData((prev) => {
        const next = deepClone(prev);
        const node = findByPath(next, path);
        if (node) node.name = trimmed;
        // Rename may change alphabetical position — re-sort so the
        // whole tree stays A → Z.
        sortDeep(next);
        emit(next);
        return next;
      });
      return null;
    });
  }, [emit]);

  const cancelEdit = useCallback(() => {
    setEditingPath((path) => {
      if (!path) return null;
      setViewData((prev) => {
        const next = deepClone(prev);
        const node = findByPath(next, path);
        if (node && (!node.name || !node.name.trim())) {
          const parentPath = path.slice(0, -1);
          const idx = path[path.length - 1];
          const parent =
            parentPath.length === 0 ? next : findByPath(next, parentPath);
          if (parent && Array.isArray(parent.children)) {
            parent.children.splice(idx, 1);
            if (parent.children.length === 0) delete parent.children;
          }
          emit(next);
          return next;
        }
        return prev;
      });
      return null;
    });
  }, [emit]);

  // Latest handler refs so d3 handlers created in useLayoutEffect can
  // always reach the freshest closures.
  const handlersRef = useRef({});
  handlersRef.current = { startAddChild, startAddPeer, startRename, commitEdit, cancelEdit, requestDelete };

  // Timer used to distinguish a single click (toggle expand/collapse)
  // from a double click (focus/zoom-to-node) on a node circle. Persists
  // across useLayoutEffect re-renders.
  const clickTimerRef = useRef(null);

  // -------------------------------------------- tree render (D3)
  useLayoutEffect(() => {
    if (!svgRef.current || !containerRef.current || !viewData) return;

    const container = containerRef.current;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Layout constants — tightened for high-density hierarchies. dx is
    // vertical spacing between siblings; dy is horizontal step between
    // depth levels. Values must stay large enough to accommodate the
    // Layout constants — tightened for high-density hierarchies. dx is
    // vertical spacing between siblings; dy is horizontal step between
    // depth levels. Bumped to 32 (Aug 2026) so the on-canvas "+ Sibling"
    // chip has room to float below the label without overlapping the
    // next row's text.
    const marginTop = 20;
    const marginBottom = 20;
    const marginLeft = 40;
    const nodeRadius = 5;
    const dx = 32; // vertical spacing between siblings

    // Depth colours reverted to brand orange at every level
    // (user feedback: multi-colour palette looked gross).
    const depthColor = () => "#ec9324";

    const dataClone = JSON.parse(JSON.stringify(viewData));
    const root = d3.hierarchy(dataClone);

    let idCounter = 0;
    // PASS 1 — assign IDs and snapshot every node's `_children`.
    // IMPORTANT: this pass must NOT mutate `.children`, otherwise d3's
    // iterator (which reads node.children AFTER the callback fires) will
    // stop descending that branch. Skipping this step for descendants
    // causes them to never get `_children` set, which was breaking
    // collapse/expand at deep levels (SaaS, Biotechnology, etc.):
    //   - filled circle turns to outline after collapse
    //   - subsequent clicks do nothing (hasKids() → false)
    //   - re-expanding a parent auto-explodes all the way to leaves
    root.each((d) => {
      d.id = idCounter++;
      d._children = d.children;
    });
    // PASS 2 — collapse every node at or past the default depth.
    // We use root.descendants() (an array snapshot) so nulling one node's
    // .children doesn't hide descendants from the loop — we've captured
    // them all up front and can safely null-out at any depth in one go.
    if (Number.isFinite(defaultExpandDepth)) {
      root.descendants().forEach((d) => {
        if (d.depth >= defaultExpandDepth && d.children) {
          d.children = null;
        }
      });
    }

    const dy = 1; // minimal — real horizontal position is assigned per depth below
    const treeLayout = d3.tree().nodeSize([dx, dy]);
    // Horizontal cubic bezier link generator (source on the LEFT, target
    // on the RIGHT). We drive it with adjusted endpoints so the line
    // STARTS after the source label ends and ENDS just before the target
    // circle — no more overlap with node names.
    const bezier = d3.linkHorizontal().x((d) => d.y).y((d) => d.x);

    root.x0 = 0;
    root.y0 = 0;

    // has-any-children?
    const hasKids = (d) =>
      (Array.isArray(d._children) && d._children.length > 0) ||
      (Array.isArray(d.children) && d.children.length > 0);

    // ALL labels always on the RIGHT of the circle (per user request
    // 2026-07-31 v10) — no more label-on-the-left for parent nodes.
    const labelOnLeft = () => false;

    // Map<hierarchyNodeId, labelPixelWidth> — populated after nodeEnter
    // renders the labels, used to offset the outgoing link start.
    const labelWidthById = new Map();
    // Slightly wide-side approximation (7.6 factor + 8 pad) so we err on the
    // side of *more* column width, which prevents links from starting AFTER
    // the next depth's column (the "reverse-order" visual bug).
    const approxLabelW = (d) => Math.max(28, ((d.data.name || "").length * 7.6) + 8);
    const measuredW = (d) => {
      const m = labelWidthById.get(d.id);
      const a = approxLabelW(d);
      // Use the LARGER of measured & approx so a slightly-wide font glyph
      // never causes overflow past its allotted column.
      if (m == null) return a;
      return Math.max(m, a);
    };

    // ----------------------------------------------------------------
    // Dynamic per-depth column layout.
    // Every column's width is sized to the widest label at that depth
    // PLUS the fixed link-gap AND (in edit mode) a fixed BUTTON_ZONE so
    // the on-canvas Add sub-segment / Delete icon buttons never sit on
    // top of the outgoing link lines. (Aug 3 2026 fix.)
    // ----------------------------------------------------------------
    const COL_LABEL_PAD = 12;   // where label starts inside its column (matches text x=12)
    const COL_GAP_END   = 8;    // gap between link-end and next circle
    const COL_SAFETY    = 12;   // extra breathing room
    // BUTTON_ZONE: reserved horizontal space AFTER the label for the two
    // 22×22 icon buttons (+ Add sub-segment, then Delete) + hover halo.
    // Only reserved when the tree is in EDIT mode — view mode stays tight.
    // Two buttons at 22px each + 6px gap + 8px trailing = ~58px.
    const BUTTON_ZONE   = editable ? 60 : 0;
    // Gap between the label-end (or button-zone-end in edit mode) and
    // the start of the outgoing link line. This is what depthAdvance
    // uses AND what linkPath uses so they always agree.
    const COL_GAP_START = BUTTON_ZONE + 12;

    // The link source is drawn AFTER the source label + button zone; the
    // link target is drawn just BEFORE the next circle.
    //
    // Extra breathing room for the L1 → L2 transition: the root fans out
    // to every top-level category (26+ children) so link curves need
    // horizontal space to spread out.
    const EXTRA_L1_L2_ADVANCE = 120;
    const depthAdvance = (labelW, extra = 0) =>
      COL_LABEL_PAD + labelW + COL_GAP_START + COL_GAP_END + COL_SAFETY + extra;

    // Compute per-depth max label width (using visible descendants only)
    // and cumulative column X. Recomputed on every update() because
    // expand/collapse changes which nodes participate.
    let colX = [0];
    function recomputeColumns() {
      colX = [0];
      const maxByDepth = new Map();
      root.each((d) => {
        const w = measuredW(d);
        const cur = maxByDepth.get(d.depth) || 0;
        if (w > cur) maxByDepth.set(d.depth, w);
      });
      const maxDepth = root.height; // 0 for a lone root
      for (let dd = 1; dd <= maxDepth; dd++) {
        // Add EXTRA_L1_L2_ADVANCE only for the first hop (depth 0 → 1) so
        // the root's outbound fan-out has room to breathe. Every other
        // column keeps the tight, label-width-fitted advance.
        const extra = dd === 1 ? EXTRA_L1_L2_ADVANCE : 0;
        colX[dd] = colX[dd - 1] + depthAdvance(maxByDepth.get(dd - 1) || 0, extra);
      }
    }

    // Build a link path that starts AFTER the source's label AND the
    // reserved button zone (edit mode only). Uses a standard midpoint
    // cubic bezier — control points at 50% of the horizontal span —
    // which spreads out fan-out curves visually so a many-children
    // parent doesn't produce a cluster of overlapping arcs.
    const linkPath = (link) => {
      const src = link.source;
      const tgt = link.target;
      // Link starts AFTER label AND button zone in edit mode.
      const srcHoriz = src.y + 12 + measuredW(src) + BUTTON_ZONE + 8;
      const tgtHoriz = tgt.y - COL_GAP_END;
      const midX = (srcHoriz + tgtHoriz) / 2;
      return `M${srcHoriz},${src.x} C${midX},${src.x} ${midX},${tgt.x} ${tgtHoriz},${tgt.x}`;
    };

    // Path lookup for the current hierarchy (uses d.data references).
    const pathOf = (d) => {
      const path = [];
      let n = d;
      while (n && n.parent) {
        const idx = (n.parent.data.children || []).indexOf(n.data);
        if (idx < 0) return null;
        path.unshift(idx);
        n = n.parent;
      }
      return path;
    };

    const gRoot = svg.append("g");

    // -----------------------------------------------------------------
    // Viewport preservation across React re-renders.
    //
    // This useLayoutEffect re-runs on every viewData / editingPath
    // change (add / rename / delete / inline-edit commit) and wipes
    // `svg.selectAll("*")` — including gRoot. However d3-zoom stores
    // the current pan+zoom transform as `svg.__zoom` on the SVG DOM
    // node itself, which SURVIVES the child wipe.
    //
    // If we don't re-apply that persisted transform to the freshly-
    // created gRoot, the tree visually snaps back to the origin on
    // every inline edit until the next mouse gesture fires. That
    // exactly matches the "viewport jumps / recenters" symptoms the
    // spec forbids.
    //
    // We therefore reapply `svg.__zoom` to gRoot RIGHT NOW so the k,
    // x, y in effect right before the rebuild are still in effect
    // right after.
    // -----------------------------------------------------------------
    {
      const persisted = svgRef.current.__zoom;
      if (persisted && didInitialFitRef.current) {
        gRoot.attr("transform", persisted.toString());
      }
    }

    const gLink = gRoot.append("g")
      .attr("fill", "none")
      .attr("stroke", "#cbd5e1")
      .attr("stroke-opacity", 0.9)
      .attr("stroke-width", 1.5);
    const gNode = gRoot.append("g")
      .attr("cursor", "pointer")
      .attr("pointer-events", "all");

    // ------------------------------------------ update()
    // opts.anchor (optional) — { node, oldX, oldY }:
    //   Preserves the anchor node's on-screen pixel position across the
    //   layout change, so an expand/collapse never yanks the tree around
    //   the clicked node. If the newly-visible descendants would overflow
    //   the viewport, we add a minimal extra pan (intelligent auto-pan)
    //   so users always see what they just revealed without losing sight
    //   of the parent.
    function update(source, event, opts) {
      const duration = event && event.altKey ? 2500 : 260;
      const nodes = root.descendants().reverse();
      const links = root.links();

      treeLayout(root);

      // Re-assign each node's HORIZONTAL position (d.y) based on the
      // per-depth column X we computed from label widths — this replaces
      // d3.tree's uniform dy*depth spacing so long labels never bleed into
      // the next column. Vertical (d.x) stays exactly as Reingold-Tilford
      // computed it, which correctly prevents subtree overlap vertically.
      recomputeColumns();
      root.each((d) => {
        d.y = colX[d.depth] || 0;
      });

      const cw = container.clientWidth || 1000;
      const ch = container.clientHeight || 600;

      // Use standard SVG coordinates (no viewBox distortion). d3.zoom
      // controls the pan+zoom transform on gRoot.
      svg.attr("viewBox", `0 0 ${cw} ${ch}`)
        .attr("preserveAspectRatio", "xMidYMid meet");

      const transition = svg.transition().duration(duration);

      // -------- Viewport-preserving pan (anchor + auto-pan) ------------
      // We animate the zoom transform in parallel with the node/link
      // transitions using the same duration & easing → the tree "breathes
      // open" around the clicked node instead of the whole thing shifting.
      if (opts && opts.anchor && zoomBehaviorRef.current) {
        const anchor = opts.anchor;
        const t = d3.zoomTransform(svgRef.current);
        // Delta in LOGICAL coords needed to keep the clicked node at the
        // exact same screen pixel it was at before the toggle.
        //   screen = t.x + logicalY * t.k
        //   old_logicalY was anchor.oldY; new_logicalY is anchor.node.y.
        // translateBy(dx, dy) shifts the transform's tx by t.k * dx, so
        // passing (oldY - newY, oldX - newX) is exactly right.
        let dX = anchor.oldY - anchor.node.y;
        let dY = anchor.oldX - anchor.node.x;

        // ---- Intelligent auto-pan: after anchor, if the anchor's newly-
        // visible subtree runs past the viewport, add just enough extra
        // pan to bring it in without pushing the parent off-screen.
        if (anchor.node.children && anchor.node.children.length > 0) {
          const margin = 24;
          // Where would the transform sit after the anchor delta?
          const projTx = t.x + t.k * dX;
          const projTy = t.y + t.k * dY;
          // Bounding box of the anchor's subtree in LOGICAL coords.
          let maxRight = -Infinity, minLeft = Infinity, maxBottom = -Infinity, minTop = Infinity;
          anchor.node.each((cc) => {
            const lw = measuredW(cc);
            const r  = cc.y + 12 + lw;
            const l  = cc.y - nodeRadius;
            const bT = cc.x - 14;
            const bB = cc.x + 14;
            if (r > maxRight) maxRight = r;
            if (l < minLeft)  minLeft  = l;
            if (bB > maxBottom) maxBottom = bB;
            if (bT < minTop)   minTop   = bT;
          });

          // Right overflow → pan the tree LEFT by the overflow amount.
          const rightScreen = projTx + maxRight * t.k;
          if (rightScreen > cw - margin) {
            dX -= (rightScreen - (cw - margin)) / t.k;
          }
          // Bottom overflow
          const botScreen = projTy + maxBottom * t.k;
          if (botScreen > ch - margin) {
            dY -= (botScreen - (ch - margin)) / t.k;
          }
          // Top overflow (mostly when collapsing repositions upward)
          const topScreen = projTy + minTop * t.k;
          if (topScreen < margin) {
            dY += (margin - topScreen) / t.k;
          }
          // NOTE: we deliberately do NOT correct left overflow — that
          // would push the parent off-screen, which the spec forbids.
        }

        if (Math.abs(dX) > 0.1 || Math.abs(dY) > 0.1) {
          svg.transition().duration(duration).ease(d3.easeCubicOut)
            .call(zoomBehaviorRef.current.translateBy, dX, dY);
        }
      }

      // ---- Nodes
      const node = gNode.selectAll("g.seg-node").data(nodes, (d) => d.id);
      const nodeEnter = node.enter().append("g")
        .attr("class", "seg-node")
        .attr("transform", () => `translate(${source.y0},${source.x0})`)
        .attr("fill-opacity", 0)
        .attr("stroke-opacity", 0);

      nodeEnter.append("circle")
        .attr("class", "seg-circle")
        .attr("r", nodeRadius)
        // Depth-based colour palette so each level is visually distinct.
        // Nodes WITH sub-segments = solid fill; leaves = white fill,
        // coloured stroke — both use the same depth colour so a branch
        // reads at a glance.
        .attr("fill", (d) => (hasKids(d) ? depthColor(d) : "#fff"))
        .attr("stroke", (d) => depthColor(d))
        .attr("stroke-width", 2)
        // Single-click on the circle = toggle expand/collapse WITH anchor
        // preservation. Double-click = smooth focus/zoom onto the node.
        // We debounce the single-click by 220 ms so a double-click never
        // fires a spurious toggle-toggle-focus sequence.
        .on("click", (evt, d) => toggleNodeClick(evt, d))
        .on("dblclick", (evt, d) => focusNodeClick(evt, d));

      // Shared click handlers (circle AND, in view mode, the label text).
      function toggleNodeClick(evt, d) {
          evt.stopPropagation();
          if (!hasKids(d)) return;
          if (clickTimerRef.current) {
            clearTimeout(clickTimerRef.current);
          }
          clickTimerRef.current = setTimeout(() => {
            clickTimerRef.current = null;
            // Toggle expand/collapse — ALWAYS one level at a time.
            //   • Collapse: stash current children into _children, hide.
            //   • Expand : reveal _children, and force each revealed
            //              child to appear as a leaf by stashing ITS
            //              children into _children too. That guarantees
            //              a single-level expansion regardless of what
            //              state the subtree was in previously (e.g.
            //              after an Expand All → collapseAll cycle).
            if (d.children) {
              d._children = d.children;
              d.children = null;
            } else if (d._children) {
              d.children = d._children;
              d.children.forEach((c) => {
                if (c.children && c.children.length) {
                  if (!c._children) c._children = c.children;
                  c.children = null;
                }
              });
            }
            // Re-layout WITHOUT anchor (fitToView will take over the
            // viewport). This behaves like a "focus on newly revealed
            // content" — the tree re-fits so the just-opened branch is
            // fully visible without the user having to zoom out.
            update(d, evt);
            fitToView(true);
          }, 220);
      }
      function focusNodeClick(evt, d) {
          evt.stopPropagation();
          if (clickTimerRef.current) {
            clearTimeout(clickTimerRef.current);
            clickTimerRef.current = null;
          }
          focusNode(d);
      }

      // Label — hidden when this node is currently being edited (replaced
      // by a foreignObject <input> in renderInlineEditor below). Always
      // rendered on the RIGHT of the circle so long names never clip and
      // the outgoing link doesn't cross the text.
      //   • VIEW mode : click = expand / collapse (same as the circle),
      //                 double-click = focus/zoom — the label is a far bigger
      //                 hit target than the 12 px circle.
      //   • EDIT mode : click = select node, double-click = inline rename.
      nodeEnter.append("text")
        .attr("class", "seg-label")
        .attr("dy", "0.32em")
        .attr("x", 12)
        .attr("text-anchor", "start")
        .attr("paint-order", "stroke")
        .attr("stroke", "white")
        .attr("stroke-width", 3)
        .attr("stroke-linejoin", "round")
        .attr("fill", "#111827")
        .style("font-size", "13px")
        .style("font-family", "Inter, system-ui, sans-serif")
        .style("font-weight", (d) => (d.depth === 0 ? "700" : "500"))
        .style("cursor", (d) => (editable || hasKids(d) ? "pointer" : "default"))
        .text((d) => d.data.name || "")
        .on("click", (evt, d) => {
          if (!editable) { toggleNodeClick(evt, d); return; }
          evt.stopPropagation();
          selectedIdRef.current = d.id;
          renderSelectionRing();
          renderAddChips();
        })
        .on("dblclick", (evt, d) => {
          if (!editable) { focusNodeClick(evt, d); return; }
          evt.stopPropagation();
          handlersRef.current.startRename(d);
        });

      const nodeUpdate = node.merge(nodeEnter).transition(transition)
        .attr("transform", (d) => `translate(${d.y},${d.x})`)
        .attr("fill-opacity", 1)
        .attr("stroke-opacity", 1);

      nodeUpdate.select("circle.seg-circle")
        .attr("fill", (d) => (hasKids(d) ? depthColor(d) : "#fff"))
        .attr("stroke", (d) => depthColor(d));

      node.exit().transition(transition).remove()
        .attr("transform", () => `translate(${source.y},${source.x})`)
        .attr("fill-opacity", 0)
        .attr("stroke-opacity", 0);

      // Measure label widths NOW that labels are in the DOM — links that
      // depend on them are rendered right after this step.
      gNode.selectAll("text.seg-label").each(function (d) {
        try {
          const bb = this.getBBox();
          if (bb && bb.width > 0) labelWidthById.set(d.id, bb.width);
        } catch (_e) { /* getBBox can throw on detached nodes */ }
      });

      // ---- Links (custom path — starts after source label, ends before
      // target circle so it never overlaps a name)
      const link = gLink.selectAll("path.seg-link").data(links, (d) => d.target.id);
      const linkEnter = link.enter().append("path")
        .attr("class", "seg-link")
        .attr("d", () => {
          // Enter from source's previous position — approximate the same
          // "after-label" origin so the animation feels grounded.
          const srcH = source.y0 + 12 + approxLabelW({ data: { name: "" } }) + 8;
          const o = { y: srcH, x: source.x0 };
          return bezier({ source: o, target: o });
        });
      link.merge(linkEnter).transition(transition).attr("d", linkPath);
      link.exit().transition(transition).remove()
        .attr("d", () => {
          const srcH = source.y + 12 + approxLabelW({ data: { name: "" } }) + 8;
          const o = { y: srcH, x: source.x };
          return bezier({ source: o, target: o });
        });

      root.eachBefore((d) => { d.x0 = d.x; d.y0 = d.y; });

      window.requestAnimationFrame(() => {
        renderSelectionRing();
        renderAddChips();
        renderInlineEditor();
      });
    }

    // ------------------------------------------ selection ring
    function renderSelectionRing() {
      gNode.selectAll("circle.seg-select-ring").remove();
      if (!editable || selectedIdRef.current == null) return;
      gNode.selectAll("g.seg-node")
        .filter((d) => d.id === selectedIdRef.current)
        .insert("circle", "circle.seg-circle")
        .attr("class", "seg-select-ring")
        .attr("r", nodeRadius + 5)
        // Selection halo colour: brand orange (was blue pre-Aug 2026 —
        // spec now requires orange so the halo matches the app palette).
        .attr("fill", "rgba(236,147,36,0.10)")
        .attr("stroke", "#ec9324")
        .attr("stroke-width", 1.75);
    }

    // ------------------------------------------ chips
    // COMPACT ICON BUTTONS. Three variants:
    //   • kind="add-child" → solid orange, white "+" glyph → adds sub-segment
    //   • kind="delete"    → white circle, red border, red trash glyph → delete node
    function drawIconButton(g, kind, cx, cy, hNode) {
      const isDelete = kind === "delete";
      const btnR = 11;
      const cls = isDelete ? "seg-delete-chip" : "seg-add-chip";
      const dataMode = isDelete ? "delete" : "add-child";
      const btn = g.append("g")
        .attr("class", cls)
        .attr("data-mode", dataMode)
        .attr("transform", `translate(${cx},${cy})`)
        .attr("cursor", "pointer")
        .on("click", (evt) => {
          evt.stopPropagation();
          if (isDelete) handlersRef.current.requestDelete(hNode);
          else handlersRef.current.startAddChild(hNode);
        });
      btn.append("circle")
        .attr("r", btnR + 2)
        .attr("fill", "#ffffff")
        .attr("stroke", "none");
      btn.append("circle")
        .attr("r", btnR)
        .attr("fill", isDelete ? "#ffffff" : "#ec9324")
        .attr("stroke", isDelete ? "#dc2626" : "#ec9324")
        .attr("stroke-width", isDelete ? 1.75 : 1);
      if (isDelete) {
        // Simple trash glyph: rounded lid + body rectangle.
        btn.append("path")
          .attr("d", "M -4,-3 L 4,-3 M -3,-3 L -3,4 Q -3,5 -2,5 L 2,5 Q 3,5 3,4 L 3,-3 M -1,-3 L -1,-5 L 1,-5 L 1,-3")
          .attr("fill", "none")
          .attr("stroke", "#dc2626")
          .attr("stroke-width", 1.4)
          .attr("stroke-linecap", "round")
          .attr("stroke-linejoin", "round")
          .style("pointer-events", "none");
      } else {
        const glyphColor = "#ffffff";
        btn.append("line")
          .attr("x1", -5).attr("y1", 0).attr("x2", 5).attr("y2", 0)
          .attr("stroke", glyphColor).attr("stroke-width", 2)
          .attr("stroke-linecap", "round")
          .style("pointer-events", "none");
        btn.append("line")
          .attr("x1", 0).attr("y1", -5).attr("x2", 0).attr("y2", 5)
          .attr("stroke", glyphColor).attr("stroke-width", 2)
          .attr("stroke-linecap", "round")
          .style("pointer-events", "none");
      }
      // Hover tooltip.
      const tt = btn.append("g")
        .attr("class", "seg-chip-tooltip")
        .style("opacity", 0)
        .style("pointer-events", "none");
      const ttText = isDelete ? "Delete" : "Add sub-segment";
      const ttW = ttText.length * 6.2 + 12;
      tt.append("rect")
        .attr("x", -ttW / 2).attr("y", btnR + 6)
        .attr("width", ttW).attr("height", 20)
        .attr("rx", 4).attr("ry", 4)
        .attr("fill", "#111827");
      tt.append("text")
        .attr("x", 0).attr("y", btnR + 20)
        .attr("text-anchor", "middle")
        .attr("fill", "#ffffff")
        .style("font-size", "10.5px")
        .style("font-weight", "500")
        .text(ttText);
      btn.on("mouseenter", () => tt.transition().duration(120).style("opacity", 1));
      btn.on("mouseleave", () => tt.transition().duration(120).style("opacity", 0));
    }

    function renderAddChips() {
      gNode.selectAll("g.seg-add-chip").remove();
      gNode.selectAll("g.seg-add-peer-chip").remove();
      gNode.selectAll("g.seg-delete-chip").remove();
      if (!editable) return;
      // Never show chips on the node that's currently being edited — the
      // input would fight for space.
      const editing = editingPath;
      gNode.selectAll("g.seg-node").each(function (d) {
        if (selectedIdRef.current !== d.id) return;
        const path = pathOf(d);
        if (pathsEqual(path, editing)) return;
        const g = d3.select(this);
        const labelSel = g.select("text.seg-label");
        const labelNode = labelSel.node();
        const bbox = labelNode ? labelNode.getBBox() : { x: 12, width: 60 };

        // (Aug 3 2026) Sibling button removed — user adds siblings via
        // the PARENT node's "Add sub-segment" button. Only two icon
        // buttons remain on a selected node:
        //   • Add sub-segment (orange +) — available on every node
        //     including the root.
        //   • Delete           (red trash) — depth >= 1 only (root
        //     itself cannot be deleted from within the tree editor).
        const gapAfterLabel = 16;
        const btnSpacing = 28;
        const subX = bbox.x + bbox.width + gapAfterLabel;
        drawIconButton(g, "add-child", subX, 0, d);
        if (d.depth >= 1) {
          drawIconButton(g, "delete", subX + btnSpacing, 0, d);
        }
      });
    }

    // ------------------------------------------ inline editor
    // Renders a <foreignObject> containing an <input> on the node whose
    // path matches editingPath. Fully in-canvas — no popup.
    function renderInlineEditor() {
      gNode.selectAll("foreignObject.seg-edit").remove();
      if (!editable || !editingPath) return;

      const target = gNode.selectAll("g.seg-node").filter((d) => {
        const p = pathOf(d);
        return pathsEqual(p, editingPath);
      });
      if (target.empty()) return;

      // Hide the static label for this node while editing.
      target.select("text.seg-label").style("display", "none");

      const foDatum = target.datum();
      const startsOnLeft = labelOnLeft(foDatum);
      const foWidth = 220;
      const foHeight = 30;
      const foX = startsOnLeft ? -foWidth - 4 : 10;
      const foY = -foHeight / 2;

      const fo = target.append("foreignObject")
        .attr("class", "seg-edit")
        .attr("x", foX)
        .attr("y", foY)
        .attr("width", foWidth)
        .attr("height", foHeight);

      const wrap = fo.append("xhtml:div")
        .attr("style",
          "width:100%;height:100%;display:flex;align-items:center;box-sizing:border-box;");

      const input = wrap.append("xhtml:input")
        .attr("type", "text")
        .attr("placeholder",
          foDatum.data.name ? "Rename node" : "Type a name…")
        .attr("maxlength", "120")
        .attr("data-testid", "tree-inline-input")
        .attr("style",
          "flex:1;height:26px;padding:2px 8px;border:1.5px solid #ec9324;" +
          "border-radius:6px;font:600 12.5px/1.2 Inter,system-ui,sans-serif;" +
          "outline:none;box-shadow:0 0 0 3px rgba(236,147,36,0.20);" +
          "background:white;color:#111827;");

      const el = input.node();
      el.value = foDatum.data.name || "";

      // Focus + select next tick (after DOM insertion) — using rAF twice
      // to survive both the current transition and the mount tick.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            el.focus();
            el.select();
          } catch (_e) { /* noop */ }
        });
      });

      // We use vanilla listeners rather than d3.on so the events are
      // guaranteed to fire before D3's own delegated handlers.
      el.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter") {
          evt.preventDefault();
          handlersRef.current.commitEdit(el.value);
        } else if (evt.key === "Escape") {
          evt.preventDefault();
          handlersRef.current.cancelEdit();
        }
      });
      el.addEventListener("blur", () => {
        // Commit-on-blur; empty value cancels (removes placeholder).
        handlersRef.current.commitEdit(el.value);
      });
      // Prevent the SVG-level click that would deselect / lose focus.
      el.addEventListener("click", (evt) => evt.stopPropagation());
      el.addEventListener("mousedown", (evt) => evt.stopPropagation());
    }

    // Click on empty SVG → deselect (but not if we're editing)
    svg.on("click", () => {
      if (editingPath) return;
      if (selectedIdRef.current != null) {
        selectedIdRef.current = null;
        renderSelectionRing();
        renderAddChips();
      }
    });

    // ---------------------------------------------- Zoom + pan (d3.zoom)
    //
    // ANY wheel event → zoom around the cursor. This includes:
    //   • Mac trackpad pinch (wheel + synthetic ctrlKey=true)
    //   • Mac trackpad two-finger vertical scroll (wheel, no ctrlKey)
    //   • Windows precision trackpad pinch (wheel + ctrlKey=true)
    //   • Regular mouse wheel + Ctrl+wheel
    // The cursor position is ALWAYS the zoom anchor — d3-zoom's built-in
    // wheeled() handler captures d3.pointer(event, this) and adjusts x/y
    // so the pixel under the cursor stays fixed while k changes.
    //
    // Cross-browser/OS normalization: browsers report deltaY in
    // deltaMode 0 (px), 1 (lines) or 2 (pages). We normalize to px and
    // apply a fixed 0.003 gain — same feel on every OS/browser, whether
    // it's Chrome, Safari, Firefox, on macOS, Windows, or Linux, whether
    // it's a physical mouse wheel or a trackpad gesture.
    //
    // We DELIBERATELY drop the ctrlKey 10x multiplier that d3-zoom
    // uses by default — that was causing the "jumping / not smooth"
    // symptom on Mac trackpad pinch.
    //
    // Pan: drag on the SVG background or on link paths. Clicks on nodes
    // (labels, circles, chips) MUST NOT initiate a drag.
    const zoomBehavior = d3.zoom()
      .scaleExtent([0.1, 4])
      .wheelDelta((evt) => {
        // Normalize deltaY to pixels regardless of browser/OS.
        let dy = evt.deltaY;
        if (evt.deltaMode === 1) dy *= 16;      // lines → ~px
        else if (evt.deltaMode === 2) dy *= 400; // pages → ~px
        // 0.003 → smooth Figma/Miro-style zoom curve. Same rate whether
        // the event is a pinch (ctrlKey=true) or a plain scroll — no
        // artificial 10x multiplier on ctrlKey.
        return -dy * 0.003;
      })
      .filter((evt) => {
        // Wheel: always allow — d3-zoom handles both pinch and plain
        // wheel as cursor-anchored zoom.
        if (evt.type === "wheel") return true;
        // Ignore touchscreen pinches until we need them
        if (evt.type === "touchstart" || evt.type === "touchmove") return true;
        // For mousedown/pointerdown: only start dragging on the SVG
        // background OR link paths. Clicks on nodes (labels, circles,
        // chips) must NOT initiate a drag.
        const t = evt.target;
        if (!t) return true;
        if (t === svgRef.current) return true;
        // Allow drag on links (they have class 'seg-link')
        if (t.classList && t.classList.contains("seg-link")) return true;
        return false;
      })
      .on("start", (event) => {
        // Any user-driven zoom/pan (wheel, drag, pinch, touch) counts
        // as interaction — after this we stop auto-refitting on
        // container resize, so the user's viewport is preserved.
        // Programmatic transitions have event.sourceEvent === null and
        // do NOT flip the flag.
        if (event.sourceEvent) hasUserInteractedRef.current = true;
      })
      .on("zoom", (event) => {
        gRoot.attr("transform", event.transform.toString());
      });

    svg.call(zoomBehavior).on("dblclick.zoom", null); // preserve dbl-click rename

    zoomBehaviorRef.current = zoomBehavior;

    // Track cursor position over the SVG so the toolbar zoom buttons can
    // pivot around whatever the user is currently looking at. We DO NOT
    // clear this ref on mouseleave — the whole point is that when the
    // user's cursor moves off the SVG (typically to click a toolbar
    // button), we still zoom around the last-inspected spot instead of
    // snapping back to the abstract viewport centre.
    svg.on("mousemove.cursor", (evt) => {
      const [x, y] = d3.pointer(evt, svgRef.current);
      lastCursorRef.current = [x, y];
    });

    // -------- Focus a node: smooth centre + brief highlight ------------
    const focusNode = (d, targetScale = 1.1) => {
      if (!d) return;
      const cw = container.clientWidth || 1000;
      const ch = container.clientHeight || 600;
      // Clamp scale into the zoom extent.
      const k = Math.max(0.1, Math.min(4, targetScale));
      const target = d3.zoomIdentity
        .translate(cw / 2 - d.y * k, ch / 2 - d.x * k)
        .scale(k);
      svg.transition().duration(500).ease(d3.easeCubicOut)
        .call(zoomBehavior.transform, target);
      // Brief highlight — swell + pulse the circle so the user immediately
      // spots the newly-focused node.
      gNode.selectAll("g.seg-node")
        .filter((n) => n === d)
        .select("circle.seg-circle")
        .transition().duration(240).ease(d3.easeCubicOut)
        .attr("r", nodeRadius * 2.4)
        .attr("stroke-width", 3.5)
        .transition().delay(180).duration(360).ease(d3.easeCubicOut)
        .attr("r", nodeRadius)
        .attr("stroke-width", 2);
    };
    focusNodeRef.current = focusNode;

    // -------- Cursor-centred zoom (used by toolbar buttons + "+/-" keys)
    const zoomAtPoint = (kFactor) => {
      const [cx, cy] = lastCursorRef.current ||
        [(container.clientWidth || 1000) / 2, (container.clientHeight || 600) / 2];
      svg.transition().duration(180).ease(d3.easeCubicOut)
        .call(zoomBehavior.scaleBy, kFactor, [cx, cy]);
    };
    zoomAtPointRef.current = zoomAtPoint;

    // --- Fit-to-view: compute the bounding box of visible nodes/labels
    // and centre + scale so the whole thing fits inside the container.
    const fitToView = (animate = true) => {
      const cw = container.clientWidth || 1000;
      const ch = container.clientHeight || 600;

      // Bounding box: use tree layout coords (`d.y` horizontal, `d.x` vertical).
      // Include label widths on the right so the deepest labels never clip.
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      root.descendants().forEach((d) => {
        const lw = labelWidthById.get(d.id) != null
          ? labelWidthById.get(d.id)
          : approxLabelW(d);
        const left = d.y - nodeRadius - 4;
        const right = d.y + 12 + lw + 8;
        const top = d.x - 16;
        const bot = d.x + 16;
        if (left < minY) minY = left;
        if (right > maxY) maxY = right;
        if (top < minX) minX = top;
        if (bot > maxX) maxX = bot;
      });
      if (!isFinite(minX)) return;

      const contentW = (maxY - minY);
      const contentH = (maxX - minX);
      // Pad container edges a little
      const padX = 24;
      const padY = 20;
      const scaleX = (cw - padX * 2) / Math.max(1, contentW);
      const scaleY = (ch - padY * 2) / Math.max(1, contentH);
      const k = Math.min(1.0, scaleX, scaleY); // never upscale past 1
      const tx = padX + (cw - padX * 2 - contentW * k) / 2 - minY * k;
      const ty = padY + (ch - padY * 2 - contentH * k) / 2 - minX * k;
      const target = d3.zoomIdentity.translate(tx, ty).scale(k);
      const selection = animate ? svg.transition().duration(260) : svg;
      selection.call(zoomBehavior.transform, target);
    };
    fitToViewRef.current = fitToView;

    // -------- Collapse All / Expand All --------------------------------
    // Both operate on the CURRENT d3 hierarchy in place (same pattern as
    // the single-node toggle) and call update() WITHOUT an anchor — the
    // root sits at logical (0,0) which does not move on collapse/expand,
    // so keeping the current zoom transform gives a stable viewport.
    //
    // NOTE on Level numbering — this codebase uses the taxonomy's
    // 1-indexed labels (the header reads "Root injected as Level 1"):
    //   • User's Level 1 = d3 depth 0 (root only)
    //   • User's Level 2 = d3 depth 1 (root + direct children)
    //   • etc.
    //
    // Collapse All → collapse to Level 2 (root + its direct children remain
    // visible; every node from Level 2 downward has its children moved
    // to _children so they can be re-expanded).
    //
    // Expand All → walk every node and restore its _children back into
    // children — reveals the full tree to the max depth available.
    //
    // IMPORTANT: d3's `root.each()` uses `d.children` to descend. If we
    // set `d.children = null` inside the callback, subsequent descendants
    // are never visited. That produced a subtle bug where Collapse All
    // only touched Level 2 — Level 3+ nodes kept their .children set,
    // and later clicking a Level 2 to expand revealed two levels at once
    // (Level 3 + Level 4). We now use a custom recursive walk that
    // follows BOTH `.children` and `._children`, so every hidden or
    // visible descendant is normalised to the "one level at a time"
    // invariant.
    const walkAllDeep = (d, fn) => {
      fn(d);
      const kids = d._children || d.children;
      if (kids && kids.length) kids.forEach((k) => walkAllDeep(k, fn));
    };
    const collapseAll = () => {
      walkAllDeep(root, (d) => {
        if (d.depth >= 1) {
          const kids = d.children || d._children;
          if (kids && kids.length) {
            d._children = kids;
            d.children = null;
          }
        }
      });
      update(root);
      // Auto-fit: after a bulk collapse the tree footprint changes
      // dramatically, so we resize + centre it to the viewport. Both
      // update() and fitToView() start their own transitions and animate
      // in parallel.
      fitToView(true);
    };
    const expandAll = () => {
      walkAllDeep(root, (d) => {
        if (d._children && !d.children) {
          d.children = d._children;
        }
      });
      update(root);
      // Auto-fit for the same reason as collapseAll — the fully-expanded
      // tree usually needs a lower zoom level to fit on screen.
      fitToView(true);
    };
    collapseAllRef.current = collapseAll;
    expandAllRef.current = expandAll;

    update(root);

    // ---- INITIAL fit — multi-attempt, hard-locked after 900ms --------
    //
    // Runs a handful of fit attempts spaced across the first ~900ms of
    // mount so the FINAL container dimensions win the day (flex layout
    // often needs 100-500ms to fully settle on the very first paint).
    // Each attempt uses the CURRENT container size — later ones
    // naturally correct any earlier off-centre fit that happened while
    // the container was still growing.
    //
    // Hard guarantees:
    //   • After the 900ms window closes we set didInitialFitRef=true
    //     and NEVER auto-fit again — no ResizeObserver-triggered
    //     re-centre, no "auto-refresh yank" as the user reported.
    //   • If the user pans/zooms at any point we stop auto-fitting
    //     immediately (respects the user's viewport).
    //   • The Fit-to-screen toolbar button still recentres on demand.
    const attemptInitialFit = (isFinal) => {
      if (didInitialFitRef.current) return;
      if (hasUserInteractedRef.current) {
        didInitialFitRef.current = true; // stop future attempts
        return;
      }
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      if (cw < 100 || ch < 100) {
        // Container not laid out yet — skip; the next attempt may catch
        // up. If this is the FINAL attempt we still lock so ResizeObs
        // never fires a fit later.
        if (isFinal) didInitialFitRef.current = true;
        return;
      }
      fitToView(false);
      if (isFinal) didInitialFitRef.current = true;
    };
    const initialFitTimers = [
      setTimeout(() => attemptInitialFit(false), 100),
      setTimeout(() => attemptInitialFit(false), 250),
      setTimeout(() => attemptInitialFit(false), 500),
      setTimeout(() => attemptInitialFit(true), 900), // FINAL — locks
    ];

    // ---------------------------------------------- keyboard arrow-key pan
    const onKeyDown = (evt) => {
      if (!container.contains(document.activeElement) && document.activeElement !== container) return;
      // Do not intercept when typing inside the inline editor
      if (evt.target && evt.target.tagName === "INPUT") return;
      const step = evt.shiftKey ? 80 : 40;
      let dxKey = 0, dyKey = 0;
      switch (evt.key) {
        case "ArrowLeft":  dxKey =  step; break;
        case "ArrowRight": dxKey = -step; break;
        case "ArrowUp":    dyKey =  step; break;
        case "ArrowDown":  dyKey = -step; break;
        case "0":          if (fitToViewRef.current) { evt.preventDefault(); fitToViewRef.current(true); } return;
        case "+":
        case "=":          if (zoomAtPointRef.current) { evt.preventDefault(); zoomAtPointRef.current(1.25); } return;
        case "-":
        case "_":          if (zoomAtPointRef.current) { evt.preventDefault(); zoomAtPointRef.current(1 / 1.25); } return;
        case "f":
        case "F":          {
          // Focus on the currently selected node (if any)
          if (selectedIdRef.current != null && focusNodeRef.current) {
            const target = root.descendants().find((n) => n.id === selectedIdRef.current);
            if (target) { evt.preventDefault(); focusNodeRef.current(target); }
          }
          return;
        }
        default: return;
      }
      evt.preventDefault();
      // Keyboard pan uses a short animation for a smoother feel.
      svg.transition().duration(120).ease(d3.easeCubicOut)
        .call(zoomBehavior.translateBy, dxKey / d3.zoomTransform(svgRef.current).k, dyKey / d3.zoomTransform(svgRef.current).k);
    };
    container.addEventListener("keydown", onKeyDown);

    // ResizeObserver — the container may resize after mount (flex
    // layout settling, sidebar toggle, scrollbar appearing…). We only
    // re-run update() so the layout is recomputed for the new size —
    // we do NOT trigger any fit here. After the initial 900ms window
    // (see attemptInitialFit above) the tree stays exactly where the
    // user left it. No auto-refresh, ever.
    const ro = new ResizeObserver(() => {
      update(root);
    });
    ro.observe(container);
    return () => {
      initialFitTimers.forEach((t) => clearTimeout(t));
      ro.disconnect();
      container.removeEventListener("keydown", onKeyDown);
    };
  }, [viewData, editable, editingPath, defaultExpandDepth]);

  // -------------------------------------------- toolbar callbacks
  // Buttons zoom around the LAST-KNOWN cursor position over the SVG (or
  // the viewport centre if the cursor has never entered the canvas). This
  // matches Figma / Miro / Google Maps behaviour: the point of interest
  // stays under the cursor while the tree scales around it.
  const zoomIn = useCallback(() => {
    if (zoomAtPointRef.current) zoomAtPointRef.current(1.3);
  }, []);
  const zoomOut = useCallback(() => {
    if (zoomAtPointRef.current) zoomAtPointRef.current(1 / 1.3);
  }, []);
  const fit = useCallback(() => {
    if (fitToViewRef.current) fitToViewRef.current(true);
  }, []);
  const collapseAll = useCallback(() => {
    if (collapseAllRef.current) collapseAllRef.current();
  }, []);
  const expandAll = useCallback(() => {
    if (expandAllRef.current) expandAllRef.current();
  }, []);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="w-full h-full overflow-hidden bg-white relative outline-none focus:ring-0"
      data-testid="segmentation-tree-container"
    >
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ font: "13px Inter, system-ui, sans-serif", display: "block", cursor: "grab" }}
        data-testid="segmentation-tree-svg"
      />
      {showToolbar && (
        <div
          className="absolute top-3 right-3 z-10 flex flex-col
                     bg-white/40 backdrop-blur-xl backdrop-saturate-150
                     border border-white/70 ring-1 ring-black/5
                     rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.10)]"
          data-testid="segmentation-tree-toolbar"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* NOTE (Aug 2026): the previous "Edit tree" toggle that used to
              live at the top of this toolbar has been REMOVED — the top
              bar's single Edit pencil (in SegmentationsPage) is now the
              only entry point for both name/description edits and tree
              edits (see spec). */}
          <ToolButton
            onClick={zoomIn}
            icon={<ZoomInIcon sx={{ fontSize: 18 }} />}
            label="Zoom in"
            testid="tree-zoom-in"
            position="top"
          />
          <ToolButton
            onClick={zoomOut}
            icon={<ZoomOutIcon sx={{ fontSize: 18 }} />}
            label="Zoom out"
            testid="tree-zoom-out"
            position="middle"
          />
          <ToolButton
            onClick={fit}
            icon={<CenterFocusStrong sx={{ fontSize: 18 }} />}
            label="Fit to screen"
            testid="tree-zoom-fit"
            position="middle"
          />
          <ToolButton
            onClick={expandAll}
            icon={<UnfoldMoreIcon sx={{ fontSize: 18 }} />}
            label="Expand All"
            testid="tree-expand-all"
            position="middle"
          />
          <ToolButton
            onClick={collapseAll}
            icon={<UnfoldLessIcon sx={{ fontSize: 18 }} />}
            label="Collapse All"
            testid="tree-collapse-all"
            position="bottom"
          />
        </div>
      )}
      {/* Delete-confirmation dialog. Message includes the node name AND
          the count of its sub-segments (from Aug 3 2026 spec). */}
      {pendingDelete && (
        <div
          data-testid="tree-delete-confirm"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={cancelDelete}
        >
          <div
            className="bg-white rounded-lg shadow-2xl max-w-md w-[92%] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-gray-900 mb-2">
              Confirm delete
            </h3>
            <p className="text-sm text-gray-700 leading-relaxed">
              {pendingDelete.subCount > 0 ? (
                <>
                  Do you wanna proceed with Deleting{" "}
                  <span className="font-semibold text-gray-900">
                    {pendingDelete.name}
                  </span>{" "}
                  &amp; its {pendingDelete.subCount} sub-segment
                  {pendingDelete.subCount === 1 ? "" : "s"}?
                </>
              ) : (
                <>
                  Do you wanna proceed with Deleting{" "}
                  <span className="font-semibold text-gray-900">
                    {pendingDelete.name}
                  </span>
                  ?
                </>
              )}
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={cancelDelete}
                data-testid="tree-delete-cancel"
                className="px-3 py-1.5 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                data-testid="tree-delete-confirm-yes"
                className="px-3 py-1.5 rounded-md bg-red-600 text-white text-sm font-medium hover:bg-red-700"
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
