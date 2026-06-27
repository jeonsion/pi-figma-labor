type FlowchartNode = {
  id: string;
  label: string;
  description?: string;
  type?: "process" | "decision" | "diamond" | "terminator" | "data" | "note";
  lane?: string;
  rank?: number;
  order?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  accent?: "blue" | "green" | "orange" | "red" | "purple" | "gray";
};

type FlowchartEdge = {
  from: string;
  to: string;
  label?: string;
  kind?: "default" | "success" | "danger" | "muted";
};

type FlowchartLane = {
  id: string;
  label: string;
};

type FlowchartSpec = {
  frameName?: string;
  title: string;
  subtitle?: string;
  mode?: "replace" | "append";
  lanes?: FlowchartLane[];
  nodes: FlowchartNode[];
  edges: FlowchartEdge[];
};

type LayoutNode = Required<Pick<FlowchartNode, "id" | "label" | "type" | "lane" | "rank" | "order" | "width" | "height" | "accent">> & {
  description: string;
  x: number;
  y: number;
};

type LayoutSpec = {
  frameName: string;
  title: string;
  subtitle: string;
  mode: "replace" | "append";
  width: number;
  height: number;
  lanes: Array<FlowchartLane & { x: number; y: number; width: number; height: number }>;
  nodes: LayoutNode[];
  edges: FlowchartEdge[];
};

const stringSchema = (description?: string) => description ? { type: "string", description } : { type: "string" };
const numberSchema = (description?: string) => description ? { type: "number", description } : { type: "number" };
const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const arraySchema = (items: unknown) => ({ type: "array", items });

const laneSchema = objectSchema(
  { id: stringSchema(), label: stringSchema() },
  ["id", "label"],
);

const nodeSchema = objectSchema(
  {
    id: stringSchema("Stable node id used by edges"),
    label: stringSchema("Primary node label"),
    description: stringSchema(),
    type: stringSchema("process | decision | diamond | terminator | data | note"),
    lane: stringSchema("Lane id"),
    rank: numberSchema("Horizontal layout column; inferred if omitted"),
    order: numberSchema("Vertical order within same lane/rank"),
    x: numberSchema("Explicit x inside generated frame"),
    y: numberSchema("Explicit y inside generated frame"),
    width: numberSchema(),
    height: numberSchema(),
    accent: stringSchema("blue | green | orange | red | purple | gray"),
  },
  ["id", "label"],
);

const edgeSchema = objectSchema(
  {
    from: stringSchema(),
    to: stringSchema(),
    label: stringSchema(),
    kind: stringSchema("default | success | danger | muted"),
  },
  ["from", "to"],
);

const createParams = objectSchema(
  {
    spec: objectSchema(
      {
        frameName: stringSchema(),
        title: stringSchema(),
        subtitle: stringSchema(),
        mode: stringSchema("replace | append"),
        lanes: arraySchema(laneSchema),
        nodes: arraySchema(nodeSchema),
        edges: arraySchema(edgeSchema),
      },
      ["title", "nodes", "edges"],
    ),
  },
  ["spec"],
);

const verifyParams = objectSchema({
  frameName: stringSchema("Frame name to verify"),
  frameId: stringSchema("Frame id to verify"),
});

function inferRanks(nodes: FlowchartNode[], edges: FlowchartEdge[]): Map<string, number> {
  const rank = new Map<string, number>();
  for (const node of nodes) rank.set(node.id, node.rank ?? 0);

  let changed = true;
  let guard = 0;
  while (changed && guard++ < nodes.length * nodes.length) {
    changed = false;
    for (const edge of edges) {
      const from = rank.get(edge.from) ?? 0;
      const currentTo = rank.get(edge.to) ?? 0;
      const explicitTo = nodes.find((node) => node.id === edge.to)?.rank;
      if (explicitTo === undefined && currentTo < from + 1) {
        rank.set(edge.to, from + 1);
        changed = true;
      }
    }
  }

  return rank;
}

function layoutSpec(input: FlowchartSpec, spacing = 1): LayoutSpec {
  if (!input.nodes?.length) throw new Error("Flowchart spec requires at least one node.");

  const ids = new Set<string>();
  for (const node of input.nodes) {
    if (ids.has(node.id)) throw new Error(`Duplicate node id: ${node.id}`);
    ids.add(node.id);
  }
  for (const edge of input.edges ?? []) {
    if (!ids.has(edge.from)) throw new Error(`Edge references missing from node: ${edge.from}`);
    if (!ids.has(edge.to)) throw new Error(`Edge references missing to node: ${edge.to}`);
  }

  const laneIds = new Set((input.lanes ?? []).map((lane) => lane.id));
  for (const node of input.nodes) if (node.lane) laneIds.add(node.lane);
  if (laneIds.size === 0) laneIds.add("main");

  const lanes = input.lanes?.length
    ? input.lanes
    : [...laneIds].map((id) => ({ id, label: id === "main" ? "Flow" : id }));

  const ranks = inferRanks(input.nodes, input.edges ?? []);
  const columnGap = Math.round(330 * spacing);
  const laneGap = Math.round(44 * spacing);
  const left = 72;
  const top = 190;
  const laneInnerTop = 76;
  const rowStep = Math.round(318 * spacing); // 270px diamond + breathing room.

  const collisionCounts = new Map<string, number>();
  const prepared = input.nodes.map((node, inputIndex) => {
    const lane = node.lane ?? lanes[0].id;
    const rank = node.rank ?? ranks.get(node.id) ?? 0;
    const key = `${lane}:${rank}`;
    const stackedIndex = node.order ?? collisionCounts.get(key) ?? 0;
    collisionCounts.set(key, stackedIndex + 1);

    const type = (node.type ?? "process") as LayoutNode["type"];
    const isDiamond = type === "decision" || type === "diamond";
    const width = node.width ?? (isDiamond ? 270 : type === "terminator" ? 210 : 260);
    const height = node.height ?? (isDiamond ? 270 : type === "terminator" ? 92 : 122);
    const x = node.x ?? left + rank * columnGap;

    return {
      source: node,
      inputIndex,
      lane,
      rank,
      stackedIndex,
      type,
      width,
      height,
      x,
    };
  });

  const laneRequiredHeight = new Map<string, number>();
  for (const lane of lanes) laneRequiredHeight.set(lane.id, 245);
  for (const node of prepared) {
    const required = laneInnerTop + node.stackedIndex * rowStep + node.height + 58;
    laneRequiredHeight.set(node.lane, Math.max(laneRequiredHeight.get(node.lane) ?? 245, required));
  }

  const laneBaseY = new Map<string, number>();
  let cursorY = top;
  for (const lane of lanes) {
    laneBaseY.set(lane.id, cursorY);
    cursorY += (laneRequiredHeight.get(lane.id) ?? 245) + laneGap;
  }

  const nodes: LayoutNode[] = prepared.map((preparedNode) => {
    const node = preparedNode.source;
    const y = node.y ?? (laneBaseY.get(preparedNode.lane) ?? top) + laneInnerTop + preparedNode.stackedIndex * rowStep;

    return {
      id: node.id,
      label: node.label,
      description: node.description ?? "",
      type: preparedNode.type,
      lane: preparedNode.lane,
      rank: preparedNode.rank,
      order: node.order ?? preparedNode.inputIndex,
      width: preparedNode.width,
      height: preparedNode.height,
      accent: (node.accent ?? (preparedNode.type === "decision" || preparedNode.type === "diamond" ? "blue" : "gray")) as LayoutNode["accent"],
      x: preparedNode.x,
      y,
    };
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  function boundaryPoint(n: LayoutNode, target: LayoutNode) {
    const cx = n.x + n.width / 2;
    const cy = n.y + n.height / 2;
    const tx = target.x + target.width / 2;
    const ty = target.y + target.height / 2;
    const dx = tx - cx;
    const dy = ty - cy;
    if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) return { x: cx, y: cy };
    if (n.type === "decision" || n.type === "diamond") {
      const denom = Math.abs(dx) / (n.width / 2) + Math.abs(dy) / (n.height / 2);
      const t = denom > 0 ? 1 / denom : 0;
      return { x: cx + dx * t, y: cy + dy * t };
    }
    const txScale = Math.abs(dx) > 0.0001 ? (n.width / 2) / Math.abs(dx) : Number.POSITIVE_INFINITY;
    const tyScale = Math.abs(dy) > 0.0001 ? (n.height / 2) / Math.abs(dy) : Number.POSITIVE_INFINITY;
    const t = Math.min(txScale, tyScale);
    return { x: cx + dx * t, y: cy + dy * t };
  }
  function routePointsForBounds(p1: { x: number; y: number }, p2: { x: number; y: number }) {
    if (Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y)) {
      const midX = (p1.x + p2.x) / 2;
      return [p1, { x: midX, y: p1.y }, { x: midX, y: p2.y }, p2];
    }
    const midY = (p1.y + p2.y) / 2;
    return [p1, { x: p1.x, y: midY }, { x: p2.x, y: midY }, p2];
  }
  function pathMidForBounds(points: Array<{ x: number; y: number }>) {
    let total = 0;
    const lengths: number[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const dx = points[i + 1].x - points[i].x;
      const dy = points[i + 1].y - points[i].y;
      const len = Math.sqrt(dx * dx + dy * dy);
      lengths.push(len);
      total += len;
    }
    let target = total / 2;
    for (let i = 0; i < lengths.length; i++) {
      const len = lengths[i];
      if (target <= len || i === lengths.length - 1) {
        const t = len > 0 ? target / len : 0;
        return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
      }
      target -= len;
    }
    return points[0];
  }

  const layoutLanes = lanes.map((lane) => {
    const laneNodes = nodes.filter((node) => node.lane === lane.id);
    if (laneNodes.length === 0) {
      const y = laneBaseY.get(lane.id) ?? top;
      return { ...lane, x: 40, y, width: 520, height: laneRequiredHeight.get(lane.id) ?? 245 };
    }
    const minX = Math.min(...laneNodes.map((node) => node.x));
    const minY = Math.min(...laneNodes.map((node) => node.y));
    const maxX = Math.max(...laneNodes.map((node) => node.x + node.width));
    const maxY = Math.max(...laneNodes.map((node) => node.y + node.height));
    const laneX = Math.max(40, minX - 32);
    const laneY = Math.max(150, minY - 58);
    return {
      ...lane,
      x: laneX,
      y: laneY,
      width: maxX - laneX + 32,
      height: maxY - laneY + 36,
    };
  });

  const bounds = { minX: 40, minY: 42, maxX: 0, maxY: 0 };
  function includeBox(x: number, y: number, width: number, height: number) {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x + width);
    bounds.maxY = Math.max(bounds.maxY, y + height);
  }
  for (const lane of layoutLanes) includeBox(lane.x, lane.y, lane.width, lane.height);
  for (const node of nodes) includeBox(node.x, node.y, node.width, node.height);
  for (const edge of input.edges ?? []) {
    const a = nodeById.get(edge.from);
    const b = nodeById.get(edge.to);
    if (!a || !b) continue;
    const points = routePointsForBounds(boundaryPoint(a, b), boundaryPoint(b, a));
    for (const point of points) includeBox(point.x, point.y, 1, 1);
    for (let i = 0; i < points.length - 1; i++) {
      const dx = points[i + 1].x - points[i].x;
      const dy = points[i + 1].y - points[i].y;
      const len = Math.sqrt(dx * dx + dy * dy);
      // Figma LINE nodes keep width=len even when rotated; include that primitive bbox too.
      includeBox(points[i].x, points[i].y, len, 1);
    }
    if (edge.label) {
      const mid = pathMidForBounds(points);
      includeBox(mid.x - 90, mid.y - 18, 180, 16);
    }
  }
  includeBox(56, 42, 900, 48);
  if (input.subtitle) includeBox(58, 96, 1400, 22);

  const width = Math.max(1200, bounds.maxX + 72);
  const height = Math.max(720, bounds.maxY + 90);

  return {
    frameName: input.frameName ?? input.title,
    title: input.title,
    subtitle: input.subtitle ?? "",
    mode: input.mode === "append" ? "append" : "replace",
    width,
    height,
    lanes: layoutLanes,
    nodes,
    edges: input.edges ?? [],
  };
}

function renderScript(layout: LayoutSpec): string {
  const payload = JSON.stringify(layout).replace(/</g, "\\u003c");
  return `
const spec = ${payload};
const page = figma.currentPage;
const C = {
  navy:{r:0.045,g:0.07,b:0.13}, muted:{r:0.31,g:0.36,b:0.45},
  bg:{r:0.955,g:0.968,b:0.985}, border:{r:0.74,g:0.82,b:0.92},
  blue:{r:0.10,g:0.30,b:0.86}, green:{r:0.02,g:0.55,b:0.36}, orange:{r:0.88,g:0.45,b:0.08},
  red:{r:0.82,g:0.08,b:0.13}, purple:{r:0.48,g:0.24,b:0.82}, gray:{r:0.38,g:0.45,b:0.56},
  lane:{r:1,g:1,b:1}, note:{r:1,g:0.99,b:0.94}
};
function color(name){ return C[name] || C.gray; }
function paint(c){ return [{ type:'SOLID', color:c }]; }
function text(name, chars, x, y, size, style, colorValue, width, align){
  const t = figma.createText(); t.name = name; t.x = x; t.y = y;
  t.fontName = { family:'Inter', style }; t.fontSize = size; t.characters = chars; t.fills = paint(colorValue);
  if (width) { t.resize(width, t.height); t.textAutoResize = 'HEIGHT'; }
  if (align) t.textAlignHorizontal = align;
  return t;
}
let frame = page.children.find(n => n.name === spec.frameName && n.type === 'FRAME');
if (!frame || spec.mode === 'append') {
  frame = figma.createFrame(); frame.name = spec.frameName;
  let maxX = 0; for (const child of page.children) maxX = Math.max(maxX, child.x + child.width);
  frame.x = maxX + 160; frame.y = 80; page.appendChild(frame);
} else {
  for (const child of [...frame.children]) child.remove();
}
frame.resize(spec.width, spec.height); frame.fills = paint(C.bg); frame.cornerRadius = 28; frame.clipsContent = false;
const title = text('Flowchart title', spec.title, 56, 42, 40, 'Bold', C.navy, spec.width - 112); frame.appendChild(title);
if (spec.subtitle) { const sub = text('Flowchart subtitle', spec.subtitle, 58, 96, 17, 'Regular', C.muted, spec.width - 116); frame.appendChild(sub); }
for (const lane of spec.lanes) {
  const l = figma.createFrame(); l.name = 'Lane - ' + lane.id; l.x = lane.x; l.y = lane.y; l.resize(lane.width, lane.height); l.fills = paint(C.lane); l.strokes = paint(C.border); l.strokeWeight = 1; l.cornerRadius = 22; l.clipsContent = false; frame.appendChild(l);
  const lt = text('Lane title - ' + lane.id, lane.label, lane.x + 20, lane.y + 16, 16, 'Bold', C.navy, lane.width - 40); frame.appendChild(lt);
}
const nodeMap = new Map(spec.nodes.map(n => [n.id, n]));
function edgePoint(n, target) {
  const cx = n.x + n.width / 2;
  const cy = n.y + n.height / 2;
  const tx = target.x + target.width / 2;
  const ty = target.y + target.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) return { x: cx, y: cy, side: 'center' };

  if (n.type === 'decision' || n.type === 'diamond') {
    // Diamond/rhombus boundary: |x-cx|/(w/2) + |y-cy|/(h/2) = 1.
    const denom = Math.abs(dx) / (n.width / 2) + Math.abs(dy) / (n.height / 2);
    const t = denom > 0 ? 1 / denom : 0;
    const x = cx + dx * t;
    const y = cy + dy * t;
    const side = Math.abs(x - cx) / (n.width / 2) > Math.abs(y - cy) / (n.height / 2)
      ? (x >= cx ? 'right' : 'left')
      : (y >= cy ? 'bottom' : 'top');
    return { x, y, side };
  }

  // Rectangle boundary. Intersect the center→target ray with the closest box side.
  const halfW = n.width / 2;
  const halfH = n.height / 2;
  const txScale = Math.abs(dx) > 0.0001 ? halfW / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const tyScale = Math.abs(dy) > 0.0001 ? halfH / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const t = Math.min(txScale, tyScale);
  const x = cx + dx * t;
  const y = cy + dy * t;
  const side = txScale < tyScale
    ? (dx >= 0 ? 'right' : 'left')
    : (dy >= 0 ? 'bottom' : 'top');
  return { x, y, side };
}
function connectorVector(name, points, c){
  const minX = Math.min(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y));
  const path = points.map((p, i) => (i === 0 ? 'M' : 'L') + ' ' + Number((p.x - minX).toFixed(2)) + ' ' + Number((p.y - minY).toFixed(2))).join(' ');
  const v = figma.createVector();
  v.name = 'Connector - ' + name;
  v.x = minX;
  v.y = minY;
  v.vectorPaths = [{ windingRule: 'NONZERO', data: path }];
  v.fills = [];
  v.strokes = paint(c);
  v.strokeWeight = 2.25;
  v.opacity = 0.88;
  try { v.strokeCap = 'ARROW_LINES'; } catch(e) { try { v.strokeCap = 'ARROW_EQUILATERAL'; } catch(_) {} }
  frame.appendChild(v);
}
function edgeColor(kind){ return kind === 'success' ? C.green : kind === 'danger' ? C.red : kind === 'muted' ? C.gray : C.blue; }
function routePoints(p1, p2) {
  const horiz = Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y);
  if (horiz) {
    const midX = (p1.x + p2.x) / 2;
    return [p1, { x: midX, y: p1.y }, { x: midX, y: p2.y }, p2];
  }
  const midY = (p1.y + p2.y) / 2;
  return [p1, { x: p1.x, y: midY }, { x: p2.x, y: midY }, p2];
}
function pathMidpoint(points) {
  let total = 0;
  const lengths = [];
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const len = Math.sqrt(dx * dx + dy * dy);
    lengths.push(len);
    total += len;
  }
  let target = total / 2;
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i];
    if (target <= len || i === lengths.length - 1) {
      const t = len > 0 ? target / len : 0;
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      };
    }
    target -= len;
  }
  return points[0];
}
for (const e of spec.edges) {
  const a = nodeMap.get(e.from), b = nodeMap.get(e.to); if (!a || !b) continue;
  const p1 = edgePoint(a,b), p2 = edgePoint(b,a), c = edgeColor(e.kind);
  const name = e.from + ' to ' + e.to;
  const points = routePoints(p1, p2);
  connectorVector(name, points, c);
  if (e.label) {
    const mid = pathMidpoint(points);
    const lab = text('Connector label - '+name, e.label, mid.x - 90, mid.y - 18, 11, 'Bold', c, 180, 'CENTER');
    frame.appendChild(lab);
  }
}
for (const n of spec.nodes) {
  const accent = color(n.accent);
  if (n.type === 'decision' || n.type === 'diamond') {
    const d = figma.createPolygon(); d.name = 'Node - ' + n.id + ' diamond'; d.pointCount = 4; d.x = n.x; d.y = n.y; d.resize(n.width, n.height); d.fills = paint({r:1,g:1,b:1}); d.strokes = paint(accent); d.strokeWeight = 2; frame.appendChild(d);
    const label = n.label + (n.description ? '\\n' + n.description : ''); const tt = text('Node - '+n.id, label, n.x + n.width*0.19, n.y + n.height*0.29, 13, 'Bold', C.navy, n.width*0.62, 'CENTER'); frame.appendChild(tt);
  } else {
    const f = figma.createFrame(); f.name = 'Node - ' + n.id; f.x = n.x; f.y = n.y; f.resize(n.width,n.height); f.fills = paint(n.type === 'note' ? C.note : {r:1,g:1,b:1}); f.strokes = paint(C.border); f.strokeWeight = 1.2; f.cornerRadius = n.type === 'terminator' ? n.height/2 : 16; f.clipsContent = false; f.layoutMode = 'VERTICAL'; f.primaryAxisSizingMode='FIXED'; f.counterAxisSizingMode='FIXED'; f.paddingLeft=16; f.paddingRight=16; f.paddingTop=13; f.paddingBottom=12; f.itemSpacing=6;
    const bar=figma.createRectangle(); bar.name='accent'; bar.resize(42,4); bar.cornerRadius=2; bar.fills=paint(accent);
    const nt=text('title', n.label, 0,0,14.5,'Bold',C.navy,n.width-32); const bd=text('body', n.description || '', 0,0,11.5,'Regular',C.muted,n.width-32); bd.lineHeight={unit:'PIXELS',value:15.5};
    f.appendChild(bar); f.appendChild(nt); if(n.description) f.appendChild(bd); frame.appendChild(f);
  }
}
page.selection = [frame]; figma.viewport.scrollAndZoomIntoView([frame]);
const outOfBounds = frame.children.filter(n => 'x' in n && 'y' in n && 'width' in n && 'height' in n && (n.x < 0 || n.y < 0 || n.x + n.width > frame.width || n.y + n.height > frame.height)).map(n => ({name:n.name,type:n.type,x:n.x,y:n.y,w:n.width,h:n.height}));
function boxesOverlap(a,b){ return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }
const nodeBoxes = spec.nodes.map(n => ({ id:n.id, type:n.type, x:n.x, y:n.y, width:n.width, height:n.height }));
const overlaps = [];
for (let i=0;i<nodeBoxes.length;i++) for (let j=i+1;j<nodeBoxes.length;j++) if (boxesOverlap(nodeBoxes[i], nodeBoxes[j])) overlaps.push({ a:nodeBoxes[i].id, b:nodeBoxes[j].id });
function onRectBoundary(n,p,eps){ return Math.abs(p.x-n.x)<=eps || Math.abs(p.x-(n.x+n.width))<=eps || Math.abs(p.y-n.y)<=eps || Math.abs(p.y-(n.y+n.height))<=eps; }
function onDiamondBoundary(n,p,eps){ const cx=n.x+n.width/2, cy=n.y+n.height/2; const v=Math.abs(p.x-cx)/(n.width/2)+Math.abs(p.y-cy)/(n.height/2); return Math.abs(v-1)<=eps/Math.max(n.width,n.height); }
const disconnected = [];
for (const e of spec.edges) {
  const a = nodeMap.get(e.from), b = nodeMap.get(e.to); if (!a || !b) continue;
  const p1 = edgePoint(a,b), p2 = edgePoint(b,a);
  const ok1 = (a.type === 'decision' || a.type === 'diamond') ? onDiamondBoundary(a,p1,2) : onRectBoundary(a,p1,2);
  const ok2 = (b.type === 'decision' || b.type === 'diamond') ? onDiamondBoundary(b,p2,2) : onRectBoundary(b,p2,2);
  if (!ok1 || !ok2) disconnected.push({ from:e.from, to:e.to, sourceOnBoundary:ok1, targetOnBoundary:ok2, start:p1, end:p2 });
}
const violations = { overlaps, disconnected, outOfBounds };
return { frameId: frame.id, frameName: frame.name, width: frame.width, height: frame.height, childCount: frame.children.length, outOfBounds, violations };
`;
}

function verifyScript(frameName?: string, frameId?: string): string {
  const payload = JSON.stringify({ frameName, frameId }).replace(/</g, "\\u003c");
  return `
const input = ${payload};
let frame = input.frameId ? await figma.getNodeByIdAsync(input.frameId) : null;
if (!frame && input.frameName) frame = figma.currentPage.children.find(n => n.name === input.frameName && n.type === 'FRAME');
if (!frame) throw new Error('Flowchart frame not found');
const children = frame.children || [];
const outOfBounds = children.filter(n => 'x' in n && 'y' in n && 'width' in n && 'height' in n && (n.x < 0 || n.y < 0 || n.x + n.width > frame.width || n.y + n.height > frame.height)).map(n => ({name:n.name,type:n.type,x:n.x,y:n.y,w:n.width,h:n.height}));
const nodeCount = children.filter(n => n.name.startsWith('Node - ')).length;
const connectorCount = children.filter(n => n.name.startsWith('Connector - ')).length;
const arrowheadCount = children.filter(n => n.name.startsWith('Arrowhead - ')).length;
const laneCount = children.filter(n => n.name.startsWith('Lane - ')).length;
const nodeShapes = children.filter(n => n.name.startsWith('Node - ') && n.type !== 'TEXT').map(n => ({ id:n.name.replace(/^Node - /,'').replace(/ diamond$/,''), name:n.name, type:n.type, x:n.x, y:n.y, width:n.width, height:n.height }));
function boxesOverlap(a,b){ return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }
const overlaps = [];
for (let i=0;i<nodeShapes.length;i++) for (let j=i+1;j<nodeShapes.length;j++) if (boxesOverlap(nodeShapes[i], nodeShapes[j])) overlaps.push({ a:nodeShapes[i].id, b:nodeShapes[j].id });
const nodeById = new Map(nodeShapes.map(n => [n.id,n]));
function vectorStartEnd(vector){
  const data = vector.vectorPaths?.[0]?.data ?? '';
  const matches = [...data.matchAll(/[ML]\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)].map(m => ({ x: vector.x + Number(m[1]), y: vector.y + Number(m[2]) }));
  if (matches.length === 0) return null;
  return { start: matches[0], end: matches[matches.length - 1] };
}
function onRectBoundary(n,p,eps){ return Math.abs(p.x-n.x)<=eps || Math.abs(p.x-(n.x+n.width))<=eps || Math.abs(p.y-n.y)<=eps || Math.abs(p.y-(n.y+n.height))<=eps; }
function onDiamondBoundary(n,p,eps){ const cx=n.x+n.width/2, cy=n.y+n.height/2; const v=Math.abs(p.x-cx)/(n.width/2)+Math.abs(p.y-cy)/(n.height/2); return Math.abs(v-1)<=eps/Math.max(n.width,n.height); }
const disconnected = [];
const connectorVectors = children.filter(n => n.name.startsWith('Connector - '));
for (const connector of connectorVectors) {
  const match = connector.name.match(/^Connector - (.+) to (.+)$/);
  if (!match) continue;
  const source = nodeById.get(match[1]); const target = nodeById.get(match[2]);
  const endpoints = vectorStartEnd(connector);
  if (!source || !target || !endpoints) continue;
  const ok1 = source.type === 'POLYGON' ? onDiamondBoundary(source,endpoints.start,4) : onRectBoundary(source,endpoints.start,4);
  const ok2 = target.type === 'POLYGON' ? onDiamondBoundary(target,endpoints.end,4) : onRectBoundary(target,endpoints.end,4);
  if (!ok1 || !ok2) disconnected.push({ from:match[1], to:match[2], sourceOnBoundary:ok1, targetOnBoundary:ok2, start:endpoints.start, end:endpoints.end });
}
const strayArrowheads = children.filter(n => n.name.startsWith('Arrowhead - ')).map(n => ({ name:n.name, type:n.type, x:n.x, y:n.y, w:n.width, h:n.height }));
const violations = { overlaps, disconnected, outOfBounds, strayArrowheads };
figma.currentPage.selection = [frame]; figma.viewport.scrollAndZoomIntoView([frame]);
return { frameId: frame.id, frameName: frame.name, width: frame.width, height: frame.height, childCount: children.length, laneCount, nodeCount, renderedNodeShapeCount: nodeShapes.length, connectorCount, arrowheadCount, outOfBounds, violations };
`;
}

export function registerFlowchartTools(
  pi: any,
  deps: {
    bridgeStatus: () => Promise<{ bridge: string; plugin: string } | null>;
    bridgeCommand: (command: string, params: Record<string, unknown>, opts?: { timeout?: number; signal?: AbortSignal }) => Promise<unknown>;
  },
) {
  const { bridgeStatus, bridgeCommand } = deps;

  pi.registerCommand("figma-pi", {
    description: "Show figma-pi bridge and plugin connection status",
    handler: async (_args: any, ctx: any) => {
      const status = await bridgeStatus();
      if (!status) {
        ctx.ui.notify("figma-pi: labor bridge is not running.", "error");
        return;
      }
      ctx.ui.notify(`figma-pi bridge: ${status.bridge}\nFigma plugin: ${status.plugin}`, status.plugin === "connected" ? "success" : "warning");
    },
  });

  pi.registerCommand("pi-figma", {
    description: "Send a natural-language Figma flowchart request to the LLM. It will use figma_flowchart_create with your harness rules.",
    handler: async (args: string, ctx: any) => {
      const clean = args?.trim();
      const message = clean
        ? `Create a Figma flowchart: ${clean}. Use figma_flowchart_create with the spec from examples/tax-document-extraction.json or build a new JSON spec as needed.`
        : "Show me the figma-pi status and ask what flowchart I want to create.";
      pi.sendUserMessage(message);
    },
  });

  pi.registerTool({
    name: "figma_flowchart_create",
    label: "Create Figma Flowchart",
    description: "Create or replace a Figma flowchart from a structured JSON spec. Uses the local figma-labor bridge and renders real nodes, decision diamonds, connector VectorNodes with integrated strokeCap arrowheads, labels, lanes, and a verification summary.",
    promptSnippet: "Render structured flowchart specs into Figma with automatic layout, connector routing, and validation.",
    promptGuidelines: [
      "Use figma_flowchart_create for Figma flowcharts instead of ad-hoc labor_run_script node creation.",
      "When using figma_flowchart_create, provide stable node ids and edges; use decision nodes for branching and labels such as YES/NO on edges.",
    ],
    parameters: createParams,
    async execute(_id: any, params: any, signal: any) {
      if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }] };
      const status = await bridgeStatus();
      if (!status || status.plugin !== "connected") {
        throw new Error("Figma plugin is not connected. Run Pi Labor Local Bridge in Figma, then retry.");
      }
      const attempts = [1, 1.25, 1.5];
      let lastLayout: LayoutSpec | undefined;
      let lastResult: any;
      for (const spacing of attempts) {
        const layout = layoutSpec(params.spec as FlowchartSpec, spacing);
        const result = await bridgeCommand("run_script", { code: renderScript(layout) }, { timeout: 90_000 }) as any;
        lastLayout = layout;
        lastResult = result;
        const violations = result?.violations ?? {};
        const violationCount = (violations.overlaps?.length ?? 0) + (violations.disconnected?.length ?? 0) + (violations.outOfBounds?.length ?? 0);
        if (violationCount === 0) {
          return {
            content: [{ type: "text", text: `Created Figma flowchart '${layout.frameName}' with spacing ${spacing}.` }],
            details: { layout, result, attemptsTried: attempts.indexOf(spacing) + 1 },
          };
        }
      }
      throw new Error(`Flowchart verification failed after ${attempts.length} normalized render attempt(s): ${JSON.stringify(lastResult?.violations ?? {}, null, 2)}`);
    },
  });

  pi.registerTool({
    name: "figma_flowchart_verify",
    label: "Verify Figma Flowchart",
    description: "Verify a Figma flowchart frame for basic quality gates: node count, connector count, arrowhead count, lane count, and out-of-bounds elements.",
    parameters: verifyParams,
    async execute(_id: any, params: any, signal: any) {
      if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }] };
      const status = await bridgeStatus();
      if (!status || status.plugin !== "connected") {
        throw new Error("Figma plugin is not connected. Run Pi Labor Local Bridge in Figma, then retry.");
      }
      const result = await bridgeCommand("run_script", { code: verifyScript(params.frameName as string | undefined, params.frameId as string | undefined) }, { timeout: 30_000 });
      return {
        content: [{ type: "text", text: "Verified Figma flowchart frame." }],
        details: result,
      };
    },
  });
}
