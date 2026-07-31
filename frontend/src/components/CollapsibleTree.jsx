import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";

/**
 * CollapsibleTree — React wrapper around the classic
 * https://observablehq.com/@d3/collapsible-tree example, with INLINE
 * on-canvas node creation (no modal at all).
 *
 * Interactions (editable=true):
 *   • Click a node's label → select it (blue ring). If it's Level 2+ a
 *     BLUE "+ Peer" chip appears below the node.  All selected nodes
 *     (including root) get an ORANGE "+ Child" chip after the label.
 *   • Click "+ Child" → a new empty node is inserted right there and the
 *     cursor lands INSIDE a text input rendered on that node (via SVG
 *     foreignObject). Enter = commit, blur = commit, Esc/blank = cancel
 *     (removes the placeholder). NO popup, no modal.
 *   • Click "+ Peer" → same, but the new node is inserted as a sibling
 *     below the selected node.
 *   • Double-click a label → same inline editor, prepopulated with the
 *     current name (rename).
 *   • Click a node's ORANGE circle → collapse/expand its subtree.
 */
export default function CollapsibleTree({ data, onChange, editable = false }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const selectedIdRef = useRef(null);

  // Local mirror of the incoming `data` — we mutate this scratchpad on
  // every add / rename / cancel, and only sync back to the parent via
  // onChange after each committed action.
  const [viewData, setViewData] = useState(() =>
    data ? JSON.parse(JSON.stringify(data)) : { name: "", children: [] }
  );

  // Whenever the parent hands us a new `data` prop we reset the local
  // scratchpad and drop any in-flight edit.
  useEffect(() => {
    if (data) {
      setViewData(JSON.parse(JSON.stringify(data)));
      setEditingPath(null);
    }
  }, [data]);

  // Path (array of children indices) of the currently-editing node.
  // null → nothing being edited.
  const [editingPath, setEditingPath] = useState(null);

  // -------------------------------------------- helpers
  const deepClone = (o) => JSON.parse(JSON.stringify(o));

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
      // Focus the freshly-inserted node in the *next* layout tick.
      setEditingPath([...targetPath, t.children.length - 1]);
      return next;
    });
  }, []);

  const startAddPeer = useCallback((hNode) => {
    const targetPath = pathOfHNode(hNode);
    if (!targetPath || targetPath.length === 0) return;
    const parentPath = targetPath.slice(0, -1);
    const insertAt = targetPath[targetPath.length - 1] + 1;
    setViewData((prev) => {
      const next = deepClone(prev);
      const parent = parentPath.length === 0 ? next : findByPath(next, parentPath);
      if (!parent) return prev;
      parent.children = Array.isArray(parent.children) ? parent.children : [];
      parent.children.splice(insertAt, 0, { name: "" });
      setEditingPath([...parentPath, insertAt]);
      return next;
    });
  }, []);

  const startRename = useCallback((hNode) => {
    const p = pathOfHNode(hNode);
    if (!p) return;
    setEditingPath(p);
  }, []);

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
  handlersRef.current = { startAddChild, startAddPeer, startRename, commitEdit, cancelEdit };

  // -------------------------------------------- tree render (D3)
  useLayoutEffect(() => {
    if (!svgRef.current || !containerRef.current || !viewData) return;

    const container = containerRef.current;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Layout constants
    const marginTop = 20;
    const marginBottom = 20;
    const marginLeft = 40;
    const nodeRadius = 6;
    const dx = 60; // vertical spacing between siblings (roomy for peer chip)

    const dataClone = JSON.parse(JSON.stringify(viewData));
    const root = d3.hierarchy(dataClone);

    let idCounter = 0;
    root.each((d) => {
      d.id = idCounter++;
      d._children = d.children;
    });

    const dy = 220;
    const treeLayout = d3.tree().nodeSize([dx, dy]);
    const diagonal = d3.linkHorizontal().x((d) => d.y).y((d) => d.x);

    root.x0 = 0;
    root.y0 = 0;

    // has-any-children?
    const hasKids = (d) =>
      (Array.isArray(d._children) && d._children.length > 0) ||
      (Array.isArray(d.children) && d.children.length > 0);

    // Root ALWAYS gets its label on the RIGHT (long names never clip).
    const labelOnLeft = (d) => d.depth > 0 && hasKids(d);

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
    const gLink = gRoot.append("g")
      .attr("fill", "none")
      .attr("stroke", "#cbd5e1")
      .attr("stroke-opacity", 0.9)
      .attr("stroke-width", 1.5);
    const gNode = gRoot.append("g")
      .attr("cursor", "pointer")
      .attr("pointer-events", "all");

    // ------------------------------------------ update()
    function update(source, event) {
      const duration = event && event.altKey ? 2500 : 260;
      const nodes = root.descendants().reverse();
      const links = root.links();

      treeLayout(root);

      let top = root, bot = root;
      root.eachBefore((n) => {
        if (n.x < top.x) top = n;
        if (n.x > bot.x) bot = n;
      });
      const contentH = (bot.x - top.x) + marginTop + marginBottom;
      const cw = container.clientWidth || 1000;
      const ch = container.clientHeight || 600;

      svg.attr("viewBox", `0 0 ${cw} ${ch}`)
        .attr("preserveAspectRatio", "none");

      const yShift = Math.max(marginTop, (ch - contentH) / 2) - top.x;
      gRoot.transition()
        .duration(duration)
        .attr("transform", `translate(${marginLeft},${yShift})`);

      const transition = svg.transition().duration(duration);

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
        .attr("fill", (d) => (hasKids(d) ? "#ec9324" : "#fff"))
        .attr("stroke", "#ec9324")
        .attr("stroke-width", 2)
        .on("click", (evt, d) => {
          evt.stopPropagation();
          if (hasKids(d)) {
            d.children = d.children ? null : d._children;
            update(d, evt);
          }
        });

      // Label — hidden when this node is currently being edited (replaced
      // by a foreignObject <input> in decorateNode below).
      nodeEnter.append("text")
        .attr("class", "seg-label")
        .attr("dy", "0.32em")
        .attr("x", (d) => (labelOnLeft(d) ? -12 : 12))
        .attr("text-anchor", (d) => (labelOnLeft(d) ? "end" : "start"))
        .attr("paint-order", "stroke")
        .attr("stroke", "white")
        .attr("stroke-width", 3)
        .attr("stroke-linejoin", "round")
        .attr("fill", "#111827")
        .style("font-size", "13px")
        .style("font-family", "Inter, system-ui, sans-serif")
        .style("font-weight", (d) => (d.depth === 0 ? "700" : "500"))
        .text((d) => d.data.name || "")
        .on("click", (evt, d) => {
          evt.stopPropagation();
          if (!editable) return;
          selectedIdRef.current = d.id;
          renderSelectionRing();
          renderAddChips();
        })
        .on("dblclick", (evt, d) => {
          evt.stopPropagation();
          if (!editable) return;
          handlersRef.current.startRename(d);
        });

      const nodeUpdate = node.merge(nodeEnter).transition(transition)
        .attr("transform", (d) => `translate(${d.y},${d.x})`)
        .attr("fill-opacity", 1)
        .attr("stroke-opacity", 1);

      nodeUpdate.select("circle.seg-circle")
        .attr("fill", (d) => (hasKids(d) ? "#ec9324" : "#fff"));

      node.exit().transition(transition).remove()
        .attr("transform", () => `translate(${source.y},${source.x})`)
        .attr("fill-opacity", 0)
        .attr("stroke-opacity", 0);

      // ---- Links
      const link = gLink.selectAll("path.seg-link").data(links, (d) => d.target.id);
      const linkEnter = link.enter().append("path")
        .attr("class", "seg-link")
        .attr("d", () => {
          const o = { x: source.x0, y: source.y0 };
          return diagonal({ source: o, target: o });
        });
      link.merge(linkEnter).transition(transition).attr("d", diagonal);
      link.exit().transition(transition).remove()
        .attr("d", () => {
          const o = { x: source.x, y: source.y };
          return diagonal({ source: o, target: o });
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
        .attr("fill", "rgba(59,130,246,0.08)")
        .attr("stroke", "#3b82f6")
        .attr("stroke-width", 1.5);
    }

    // ------------------------------------------ chips
    function drawChip(g, label, x, y, mode, hNode) {
      const chipW = label.length <= 8 ? 68 : 82;
      const chipH = 20;
      const chip = g.append("g")
        .attr("class", mode === "add-peer" ? "seg-add-peer-chip" : "seg-add-chip")
        .attr("data-mode", mode)
        .attr("transform", `translate(${x - chipW / 2},${y - chipH / 2})`)
        .attr("cursor", "pointer")
        .on("click", (evt) => {
          evt.stopPropagation();
          if (mode === "add-peer") handlersRef.current.startAddPeer(hNode);
          else handlersRef.current.startAddChild(hNode);
        });
      chip.append("rect")
        .attr("width", chipW).attr("height", chipH)
        .attr("rx", chipH / 2).attr("ry", chipH / 2)
        .attr("fill", mode === "add-peer" ? "#0ea5e9" : "#ec9324")
        .attr("stroke", mode === "add-peer" ? "#0284c7" : "#d4811f")
        .attr("stroke-width", 1);
      chip.append("text")
        .attr("x", chipW / 2).attr("y", chipH / 2 + 4)
        .attr("text-anchor", "middle")
        .attr("fill", "white")
        .style("font-size", "11px")
        .style("font-weight", "600")
        .style("font-family", "Inter, system-ui, sans-serif")
        .style("pointer-events", "none")
        .text(label);
    }

    function renderAddChips() {
      gNode.selectAll("g.seg-add-chip").remove();
      gNode.selectAll("g.seg-add-peer-chip").remove();
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

        const childChipCX = labelOnLeft(d) ? 50 : bbox.x + bbox.width + 44;
        drawChip(g, "+ Child", childChipCX, 0, "add-child", d);

        if (d.depth >= 1) {
          drawChip(g, "+ Peer", 0, 26, "add-peer", d);
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

    update(root);

    const ro = new ResizeObserver(() => update(root));
    ro.observe(container);
    return () => ro.disconnect();
  }, [viewData, editable, editingPath]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden bg-white relative"
    >
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ font: "13px Inter, system-ui, sans-serif", display: "block" }}
        data-testid="segmentation-tree-svg"
      />
    </div>
  );
}
