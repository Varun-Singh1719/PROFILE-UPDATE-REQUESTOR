import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

/**
 * CollapsibleTree — React wrapper around the classic
 * https://observablehq.com/@d3/collapsible-tree example.
 *
 * Props:
 *   data      — hierarchical object { name, children?: [...] }
 *   onChange? — called with the updated data whenever the user mutates the
 *               tree (add child / rename). If omitted the tree is read-only.
 *   editable? — bool; enables the "+ Add" chip and inline rename.
 *
 * Behaviour:
 *   • Horizontal layout — root on the LEFT, tree grows to the RIGHT.
 *   • SVG fills its container and the content is vertically centered
 *     (`preserveAspectRatio="xMinYMid meet"`).
 *   • Circle click  → collapse/expand.
 *   • Label click   → select node (blue ring).
 *   • Selected node shows a "+ Add" chip AFTER the label (measured with
 *     getBBox so there's no overlap on any name length).
 *   • Label double-click → rename via the in-app modal (NOT window.prompt).
 *   • All errors surface via the same in-app modal — no browser alerts.
 */
export default function CollapsibleTree({ data, onChange, editable = false }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);

  // The last selected node id — kept in a ref so d3 handlers stay in sync
  // without triggering a re-render every time selection changes.
  const selectedIdRef = useRef(null);

  // React-managed prompt/error dialog. The d3 handlers open it through
  // setPrompt(...).  target is the *d3 hierarchy node* whose data we mutate.
  const [prompt, setPrompt] = useState(null);
  // prompt shape:
  //   { mode: 'add' | 'rename',   target: d3-node, initial: string }
  // OR
  //   { mode: 'error',            message: string }
  const [promptValue, setPromptValue] = useState("");
  const [promptError, setPromptError] = useState("");

  useEffect(() => {
    if (prompt && (prompt.mode === "add" || prompt.mode === "rename")) {
      setPromptValue(prompt.initial || "");
      setPromptError("");
    }
  }, [prompt]);

  // ---- Clone raw data from d3 hierarchy's *data* pointer -----------------
  // We MUST walk `node.data` here (the raw JS object) because our add-child
  // logic mutates `target.data.children.push(...)`. Walking `node.children`
  // (the hierarchy's own child list) would miss those mutations.
  const cloneFromRootData = useCallback((rootData) => {
    const walk = (n) => {
      const kids = Array.isArray(n?.children) ? n.children.map(walk) : [];
      return kids.length ? { name: n.name, children: kids } : { name: n.name };
    };
    return walk(rootData);
  }, []);

  // Whether the current dialog has been confirmed. On confirm, d3 handlers
  // above have queued a mutation and closed the dialog; that closing calls
  // setPrompt(null) which re-runs this effect and mutates `data`.
  const confirmPromptRef = useRef(null);

  // ------------------------------------------------------------- render tree
  useLayoutEffect(() => {
    if (!svgRef.current || !containerRef.current || !data) return;

    const container = containerRef.current;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Layout constants (from the observable notebook, tuned for our UI)
    const marginTop = 20;
    const marginRight = 220;
    const marginBottom = 20;
    const marginLeft = 40;
    const nodeRadius = 6;
    // Vertical spacing between siblings. Kept generous (60px) so the "+ Peer"
    // chip that hangs BELOW a Level 2+ node has room to sit without
    // colliding with the next sibling row.
    const dx = 60;

    // Build a shielded hierarchy — d3.hierarchy mutates the raw objects to add
    // .children pointers, so we work off a JSON clone. `d.data` will then
    // point into this *cloned* structure, giving us a safe scratchpad we can
    // mutate freely before emitting via onChange.
    const dataClone = JSON.parse(JSON.stringify(data));
    const root = d3.hierarchy(dataClone);

    // Assign a stable numeric id per node so the selection ring survives
    // collapse/expand cycles inside a single render.
    let idCounter = 0;
    root.each((d) => {
      d.id = idCounter++;
      d._children = d.children;
      // Show EVERYTHING expanded on (re)render — otherwise a freshly-added
      // child would live inside a collapsed subtree and appear to "not
      // work" from the user's POV. Users can still collapse a subtree
      // manually by clicking its parent circle.
    });

    // Horizontal tree layout — root on LEFT, branches grow RIGHT.
    const dy = 200;
    const treeLayout = d3.tree().nodeSize([dx, dy]);
    const diagonal = d3.linkHorizontal().x((d) => d.y).y((d) => d.x);

    root.x0 = 0;
    root.y0 = 0;

    // Helper: is this node currently a parent (has any child, expanded OR
    // collapsed)?  We can't just do `d._children` — an empty array `[]` is
    // TRUTHY in JS, which was mis-flagging fresh root nodes with `children:
    // []` as non-leaves and rendering their labels LEFT of the circle
    // (off-screen).  See bug fix Jul 31 2026.
    const hasKids = (d) =>
      (Array.isArray(d._children) && d._children.length > 0) ||
      (Array.isArray(d.children) && d.children.length > 0);

    // Layout direction of a node's label. Non-root, non-leaf → label LEFT
    // (observable convention). Root is ALWAYS labelled to the RIGHT so we
    // never lose long names off the left edge of the viewport.
    const labelOnLeft = (d) => d.depth > 0 && hasKids(d);

    const gRoot = svg.append("g");

    const gLink = gRoot.append("g")
      .attr("fill", "none")
      .attr("stroke", "#cbd5e1")
      .attr("stroke-opacity", 0.9)
      .attr("stroke-width", 1.5);

    const gNode = gRoot.append("g")
      .attr("cursor", "pointer")
      .attr("pointer-events", "all");

    // -------------- update() renders one d3 layout pass -------------------
    function update(source, event) {
      const duration = event && event.altKey ? 2500 : 260;
      const nodes = root.descendants().reverse();
      const links = root.links();

      treeLayout(root);

      // Content bounds (in tree coordinates)
      let top = root, bot = root;
      root.eachBefore((n) => {
        if (n.x < top.x) top = n;
        if (n.x > bot.x) bot = n;
      });
      const contentH = (bot.x - top.x) + marginTop + marginBottom;
      const cw = container.clientWidth || 1000;
      const ch = container.clientHeight || 600;

      // viewBox = container pixel dimensions → no scaling, no
      // preserveAspectRatio surprises.  We centre the tree vertically inside
      // that box via a translate on the outer group.
      svg.attr("viewBox", `0 0 ${cw} ${ch}`)
        .attr("preserveAspectRatio", "none");

      // Vertical centre: shift down by (ch - contentH)/2, then offset by
      // -top.x so the topmost node lands at that shifted origin. Root stays
      // pinned to marginLeft on the LEFT (per user request).
      const yShift = Math.max(marginTop, (ch - contentH) / 2) - top.x;
      gRoot.transition()
        .duration(duration)
        .attr("transform", `translate(${marginLeft},${yShift})`);

      const transition = svg.transition().duration(duration);

      // ------------------------------------------------------------ nodes
      const node = gNode.selectAll("g.seg-node").data(nodes, (d) => d.id);

      const nodeEnter = node.enter().append("g")
        .attr("class", "seg-node")
        .attr("transform", () => `translate(${source.y0},${source.x0})`)
        .attr("fill-opacity", 0)
        .attr("stroke-opacity", 0);

      // Circle → collapse/expand toggle
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

      // Label
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
        .text((d) => d.data.name)
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
          setPrompt({ mode: "rename", target: d, initial: d.data.name || "" });
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

      // ------------------------------------------------------------ links
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

      // Selection ring + chips are rendered AFTER the transition kicks so
      // getBBox() of the label reflects the final DOM.
      window.requestAnimationFrame(() => {
        renderSelectionRing();
        renderAddChips();
      });
    }

    // ----------------------------------------- selection ring (blue)
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

    // ---------------------------------- "+ Child" / "+ Peer" chips
    // • ROOT (depth 0): only a "+ Child" chip (peers to the root would be
    //   siblings of the root itself, which we don't support in this tree).
    // • Any depth >= 1: TWO chips
    //     – "+ Child"  → adds one level DEEPER (drawn to the RIGHT of the
    //                    label, or right of the circle for non-leaf/non-root
    //                    label-on-left nodes).
    //     – "+ Peer"   → adds a SIBLING at the same level under the same
    //                    parent (drawn BELOW the node).
    // A single helper renders a chip with a given label + click action.
    function drawChip(g, label, x, y, mode, target) {
      const chipW = label.length <= 8 ? 68 : 82;
      const chipH = 20;
      const chip = g.append("g")
        .attr("class", mode === "add-peer" ? "seg-add-peer-chip" : "seg-add-chip")
        .attr("data-mode", mode)
        .attr("transform", `translate(${x - chipW / 2},${y - chipH / 2})`)
        .attr("cursor", "pointer")
        .on("click", (evt) => {
          evt.stopPropagation();
          setPrompt({ mode, target, initial: "" });
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
      gNode.selectAll("g.seg-node").each(function (d) {
        const g = d3.select(this);
        if (selectedIdRef.current !== d.id) return;

        const labelSel = g.select("text.seg-label");
        const labelNode = labelSel.node();
        const bbox = labelNode ? labelNode.getBBox() : { x: 12, width: 60 };

        // Where does the "+ Child" chip sit horizontally?
        //   • label-on-LEFT (non-root, non-leaf) → right of the circle (x=~50)
        //   • label-on-RIGHT (root OR leaf)     → past the end of the label
        const childChipCX = labelOnLeft(d) ? 50 : bbox.x + bbox.width + 44;

        // "+ Child" — always drawn, on ALL selected nodes (root incl.)
        drawChip(g, "+ Child", childChipCX, 0, "add-child", d);

        // "+ Peer" — only for depth >= 1 (root has no peers).
        //   Drawn BELOW the current node. We centre it under the circle so
        //   it visually maps to "another sibling added below me".
        if (d.depth >= 1) {
          drawChip(g, "+ Peer", 0, 26, "add-peer", d);
        }
      });
    }

    // Click on blank → deselect
    svg.on("click", () => {
      if (selectedIdRef.current != null) {
        selectedIdRef.current = null;
        renderSelectionRing();
        renderAddChips();
      }
    });

    // ------------------------------------------ Confirm handler bridge
    // The React dialog's onConfirm needs to call back into this closure so
    // it can mutate `d.data` on the *current* hierarchy and re-render. We
    // expose that via a ref stored on the component.
    confirmPromptRef.current = ({ mode, target, value }) => {
      const trimmed = (value || "").trim();
      if (!trimmed) {
        return { error: "Name cannot be empty" };
      }
      if (trimmed.length > 120) {
        return { error: "Name cannot exceed 120 characters" };
      }
      if (!target || !target.data) {
        return { error: "Selected node no longer exists — please retry." };
      }
      if (mode === "add-child" || mode === "add") {
        // Adds a child DEEPER — one level below the target.
        if (!Array.isArray(target.data.children)) target.data.children = [];
        target.data.children.push({ name: trimmed });
      } else if (mode === "add-peer") {
        // Adds a SIBLING at the same level — a new child of the target's
        // parent, right after the target's slot.
        const parent = target.parent;
        if (!parent || !parent.data) {
          return { error: "Cannot add a peer to the root node." };
        }
        if (!Array.isArray(parent.data.children)) parent.data.children = [];
        // Insert AFTER the current target for a nicer visual (new peer
        // appears just below the currently-selected node).
        const targetIdx = parent.data.children.findIndex((c) => c === target.data);
        const insertAt = targetIdx >= 0 ? targetIdx + 1 : parent.data.children.length;
        parent.data.children.splice(insertAt, 0, { name: trimmed });
      } else if (mode === "rename") {
        target.data.name = trimmed;
      }
      // Emit the mutated data upward — walking root.data catches the push.
      const next = cloneFromRootData(root.data);
      onChange?.(next);
      return { ok: true };
    };

    // First render
    update(root);

    // Responsive resize
    const ro = new ResizeObserver(() => update(root));
    ro.observe(container);
    return () => ro.disconnect();
  }, [data, editable, onChange, cloneFromRootData]);

  // -------------------- Confirm / cancel dialog handlers ------------------
  const handleConfirm = () => {
    if (!prompt) return;
    if (prompt.mode === "error") { setPrompt(null); return; }
    const fn = confirmPromptRef.current;
    if (!fn) { setPrompt(null); return; }
    const res = fn({ mode: prompt.mode, target: prompt.target, value: promptValue });
    if (res && res.error) {
      setPromptError(res.error);
      return;
    }
    setPrompt(null);
  };

  const handleCancel = () => setPrompt(null);

  // ------------------------------------------------------------------ JSX
  return (
    <div ref={containerRef} className="w-full h-full overflow-hidden bg-white">
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ font: "13px Inter, system-ui, sans-serif", display: "block" }}
        data-testid="segmentation-tree-svg"
      />

      {/* ── Custom in-app prompt / error dialog (replaces window.prompt) ── */}
      <Dialog open={!!prompt} onOpenChange={(o) => { if (!o) handleCancel(); }}>
        <DialogContent className="max-w-sm" data-testid="tree-node-dialog">
          {prompt?.mode === "error" ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-red-600">Something went wrong</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-gray-700 pt-1">{prompt.message}</p>
              <DialogFooter>
                <Button onClick={handleCancel} className="bg-[#ec9324] hover:bg-[#d4811f] text-white">
                  OK
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>
                  {prompt?.mode === "rename"
                    ? "Rename node"
                    : prompt?.mode === "add-peer"
                      ? "Add peer node"
                      : "Add child node"}
                </DialogTitle>
              </DialogHeader>
              <div className="pt-1 space-y-3">
                <div>
                  <Label htmlFor="tree-node-input" className="text-xs font-medium text-gray-600">
                    {prompt?.mode === "rename"
                      ? "New name"
                      : prompt?.mode === "add-peer"
                        ? "Peer (sibling) name"
                        : "Child name"}
                  </Label>
                  <Input
                    id="tree-node-input"
                    value={promptValue}
                    autoFocus
                    onChange={(e) => { setPromptValue(e.target.value); setPromptError(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleConfirm(); } }}
                    placeholder={
                      prompt?.mode === "rename"
                        ? "Node name"
                        : prompt?.mode === "add-peer"
                          ? "e.g. Mid-Market"
                          : "e.g. Enterprise"
                    }
                    maxLength={120}
                    data-testid="tree-node-input"
                  />
                  {prompt?.mode === "add-peer" && prompt?.target?.data?.name && (
                    <p className="text-[11px] text-gray-500 mt-1">
                      Will be added as a sibling of&nbsp;
                      <span className="font-medium text-gray-700">
                        “{prompt.target.data.name}”
                      </span>
                    </p>
                  )}
                  {promptError && (
                    <p className="text-xs text-red-600 mt-1" data-testid="tree-node-error">
                      {promptError}
                    </p>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={handleCancel} data-testid="tree-node-cancel">
                  Cancel
                </Button>
                <Button
                  onClick={handleConfirm}
                  disabled={!promptValue.trim()}
                  className={
                    prompt?.mode === "add-peer"
                      ? "bg-[#0ea5e9] hover:bg-[#0284c7] text-white"
                      : "bg-[#ec9324] hover:bg-[#d4811f] text-white"
                  }
                  data-testid="tree-node-confirm"
                >
                  {prompt?.mode === "rename" ? "Save" : "Add"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
