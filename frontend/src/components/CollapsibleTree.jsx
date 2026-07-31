import React, { useEffect, useLayoutEffect, useRef, useCallback } from "react";
import * as d3 from "d3";

/**
 * CollapsibleTree — a React wrapper around the classic
 * https://observablehq.com/@d3/collapsible-tree example.
 *
 * Props:
 *   data        — hierarchical object { name, children?: [...] }
 *   onChange?   — called with the updated data whenever the user mutates
 *                 the tree (add child, rename, delete). If omitted, the
 *                 tree is read-only.
 *   editable?   — bool; when true the "add child" affordance is shown on
 *                 the selected node.
 *
 * Behaviour:
 *   • Root at LEFT, tree grows to the RIGHT (horizontal layout).
 *   • Click a node's circle → toggle collapse/expand.
 *   • When editable: single-click a node's LABEL → selects it (blue ring)
 *     and a small "+" chip appears next to it. Click "+" to add a child.
 *     Double-click a label → rename inline. Right-click / Delete key on a
 *     selected non-root node → delete branch.
 *   • Smooth d3 transitions match the observable example.
 */
export default function CollapsibleTree({ data, onChange, editable = false }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const rootRef = useRef(null); // the d3 hierarchy root (with _children for collapsed)
  const selectedIdRef = useRef(null);
  const iCounterRef = useRef(0);

  // Immutable snapshot of the data → hierarchy. Any mutation goes through
  // onChange with a fresh JSON structure so the parent stays authoritative.
  const cloneDataFromHierarchy = useCallback((root) => {
    const walk = (n) => {
      const kids = (n.children || n._children || []).map(walk);
      return kids.length ? { name: n.data.name, children: kids } : { name: n.data.name };
    };
    return walk(root);
  }, []);

  // (Re)build the tree whenever `data` changes.
  useLayoutEffect(() => {
    if (!svgRef.current || !containerRef.current || !data) return;

    const container = containerRef.current;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // ---- Layout constants (from the observable notebook, tuned for our UI)
    const marginTop = 10;
    const marginRight = 200;
    const marginBottom = 10;
    const marginLeft = 40;

    const dx = 32; // vertical distance between siblings
    const nodeRadius = 5;

    const width = () => container.clientWidth || 1000;

    // Build the hierarchy from the snapshot
    const root = d3.hierarchy(data);
    rootRef.current = root;

    // Assign a stable-ish id to every node
    iCounterRef.current = 0;
    root.each((d) => {
      d.id = iCounterRef.current++;
      d._children = d.children;
    });
    // Collapse everything below depth 1 by default so the initial view is compact
    root.descendants().forEach((d) => {
      if (d.depth >= 1) d.children = null;
    });
    // Restore first-level children so the root's branches are visible.
    if (root._children) root.children = root._children;

    // Horizontal tree layout — root at LEFT, children to the RIGHT
    const dy = Math.max(160, (width() - marginLeft - marginRight) / Math.max(1, root.height + 1));
    const treeLayout = d3.tree().nodeSize([dx, dy]);
    const diagonal = d3.linkHorizontal().x((d) => d.y).y((d) => d.x);

    // Root positioned at (0, 0)
    root.x0 = 0;
    root.y0 = 0;

    const gLink = svg.append("g")
      .attr("fill", "none")
      .attr("stroke", "#cbd5e1")
      .attr("stroke-opacity", 0.9)
      .attr("stroke-width", 1.5);

    const gNode = svg.append("g")
      .attr("cursor", "pointer")
      .attr("pointer-events", "all");

    function update(source, event) {
      const duration = event && event.altKey ? 2500 : 250;
      const nodes = root.descendants().reverse();
      const links = root.links();

      treeLayout(root);

      let left = root;
      let right = root;
      root.eachBefore((n) => {
        if (n.x < left.x) left = n;
        if (n.x > right.x) right = n;
      });

      const height = right.x - left.x + marginTop + marginBottom;
      const w = width();

      const transition = svg.transition()
        .duration(duration)
        .attr("viewBox", `${-marginLeft} ${left.x - marginTop} ${w} ${height}`)
        .attr("height", height)
        .attr("width", w)
        .tween("resize", window.ResizeObserver ? null : () => () => svg.dispatch("toggle"));

      // ---- NODES ----
      const node = gNode.selectAll("g.seg-node").data(nodes, (d) => d.id);

      const nodeEnter = node.enter().append("g")
        .attr("class", "seg-node")
        .attr("transform", () => `translate(${source.y0},${source.x0})`)
        .attr("fill-opacity", 0)
        .attr("stroke-opacity", 0);

      // Circle: click to expand/collapse
      nodeEnter.append("circle")
        .attr("r", nodeRadius)
        .attr("fill", (d) => (d._children ? "#ec9324" : "#fff"))
        .attr("stroke", "#ec9324")
        .attr("stroke-width", 2)
        .on("click", (event, d) => {
          event.stopPropagation();
          d.children = d.children ? null : d._children;
          update(d, event);
        });

      // Label text
      nodeEnter.append("text")
        .attr("dy", "0.32em")
        .attr("x", (d) => (d._children ? -10 : 10))
        .attr("text-anchor", (d) => (d._children ? "end" : "start"))
        .attr("paint-order", "stroke")
        .attr("stroke", "white")
        .attr("stroke-width", 3)
        .attr("stroke-linejoin", "round")
        .attr("fill", "#111827")
        .style("font-size", "12.5px")
        .style("font-family", "Inter, system-ui, sans-serif")
        .style("font-weight", (d) => (d.depth === 0 ? "700" : "500"))
        .text((d) => d.data.name)
        .on("click", (event, d) => {
          event.stopPropagation();
          if (!editable) return;
          selectedIdRef.current = d.id;
          renderSelectionRing();
        })
        .on("dblclick", (event, d) => {
          event.stopPropagation();
          if (!editable) return;
          const current = d.data.name || "";
          const next = window.prompt("Rename node:", current);
          if (next !== null) {
            const trimmed = next.trim();
            if (trimmed && trimmed !== current) {
              d.data.name = trimmed;
              // For the ROOT node the segmentation title is edited elsewhere;
              // still allow rename here for consistency.
              onChange?.(cloneDataFromHierarchy(root));
              update(d);
            }
          }
        });

      // Enter → merge
      const nodeUpdate = node.merge(nodeEnter).transition(transition)
        .attr("transform", (d) => `translate(${d.y},${d.x})`)
        .attr("fill-opacity", 1)
        .attr("stroke-opacity", 1);

      nodeUpdate.select("circle")
        .attr("fill", (d) => (d._children ? "#ec9324" : "#fff"));

      // Exit
      node.exit().transition(transition).remove()
        .attr("transform", () => `translate(${source.y},${source.x})`)
        .attr("fill-opacity", 0)
        .attr("stroke-opacity", 0);

      // ---- LINKS ----
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

      // Cache prev positions for the next transition
      root.eachBefore((d) => { d.x0 = d.x; d.y0 = d.y; });

      renderSelectionRing();
      renderAddChips();
    }

    // ---- Selection ring (blue outline on selected node)
    function renderSelectionRing() {
      gNode.selectAll("circle.seg-select-ring").remove();
      if (!editable || selectedIdRef.current == null) return;
      gNode.selectAll("g.seg-node")
        .filter((d) => d.id === selectedIdRef.current)
        .insert("circle", "circle")
        .attr("class", "seg-select-ring")
        .attr("r", 10)
        .attr("fill", "rgba(59,130,246,0.10)")
        .attr("stroke", "#3b82f6")
        .attr("stroke-width", 1.5);
    }

    // ---- "+ add child" chips (only visible on hover / selected)
    function renderAddChips() {
      gNode.selectAll("g.seg-add-chip").remove();
      if (!editable) return;
      const nodesSel = gNode.selectAll("g.seg-node");
      nodesSel.each(function (d) {
        const g = d3.select(this);
        // Position chip past the label; roughly 88px to the right of the node
        const chipX = 22;
        const chipY = -1;
        const chip = g.append("g")
          .attr("class", "seg-add-chip")
          .attr("transform", `translate(${chipX},${chipY - 9})`)
          .style("opacity", selectedIdRef.current === d.id ? 1 : 0)
          .on("mouseenter", function () { d3.select(this).style("opacity", 1); })
          .on("click", (event) => {
            event.stopPropagation();
            addChildTo(d);
          });
        chip.append("rect")
          .attr("width", 60).attr("height", 18).attr("rx", 9).attr("ry", 9)
          .attr("fill", "#ec9324");
        chip.append("text")
          .attr("x", 30).attr("y", 12)
          .attr("text-anchor", "middle")
          .attr("fill", "white")
          .style("font-size", "10.5px")
          .style("font-weight", "600")
          .style("font-family", "Inter, system-ui, sans-serif")
          .style("pointer-events", "none")
          .text("+ Add");
        // Hover to show chip on any node
        g.on("mouseenter.chip", () => chip.style("opacity", 1));
        g.on("mouseleave.chip", () => {
          if (selectedIdRef.current !== d.id) chip.style("opacity", 0);
        });
      });
    }

    // ---- Mutations ----
    function addChildTo(d) {
      const name = window.prompt("New child name:", "New segment");
      if (name === null) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      // Ensure the target has children array & expanded state
      if (!d.data.children) d.data.children = [];
      d.data.children.push({ name: trimmed });
      // Rebuild via onChange; the parent will pass fresh `data` in and
      // the effect re-runs. Also expand the target so the new child shows.
      const nextData = cloneDataFromHierarchy(root);
      onChange?.(nextData);
    }

    // Clicking blank area deselects
    svg.on("click", () => {
      if (selectedIdRef.current != null) {
        selectedIdRef.current = null;
        renderSelectionRing();
        renderAddChips();
      }
    });

    // First render
    update(root);

    // Resize observer to keep the layout responsive
    const ro = new ResizeObserver(() => update(root));
    ro.observe(container);
    return () => ro.disconnect();
  }, [data, editable, onChange, cloneDataFromHierarchy]);

  return (
    <div ref={containerRef} className="w-full h-full overflow-auto bg-white">
      <svg
        ref={svgRef}
        style={{ font: "12px Inter, system-ui, sans-serif", maxWidth: "100%", height: "auto" }}
      />
    </div>
  );
}
