// Spatial decomposition of a scene into disjoint sub-drawings.
//
// A canvas often accumulates several unrelated drawings (pasted iterations,
// alternative drafts, different topics) at distant positions. This module
// groups elements into clusters using connected components over bounding
// boxes inflated by a margin: two elements belong to the same drawing when
// their inflated boxes overlap. Clusters are named after their most prominent
// text element (largest fontSize) so output files are recognizable.

export interface SceneCluster {
  name: string;
  elementIds: string[];
  count: number;
  bounds: { x1: number; y1: number; x2: number; y2: number };
}

export interface ClusterOptions {
  margin?: number;
  minElements?: number;
}

const DEFAULT_MARGIN = 250;
const DEFAULT_MIN_ELEMENTS = 5;
// O(n^2) pairwise comparison; beyond this, refuse rather than hang.
const MAX_ELEMENTS = 4000;

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function elementBox(el: Record<string, any>): Box {
  const x = Number(el.x) || 0;
  const y = Number(el.y) || 0;
  return { x1: x, y1: y, x2: x + (Number(el.width) || 0), y2: y + (Number(el.height) || 0) };
}

function sanitizeName(raw: string): string {
  const cleaned = raw
    .replace(/[\n\r]+/g, ' ')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned !== '' ? cleaned : 'cluster';
}

export function clusterScene(
  elements: Array<Record<string, any>>,
  options: ClusterOptions = {}
): SceneCluster[] {
  const margin = options.margin ?? DEFAULT_MARGIN;
  const minElements = options.minElements ?? DEFAULT_MIN_ELEMENTS;
  if (elements.length > MAX_ELEMENTS) {
    throw new Error(
      `split_scene refuses scenes with more than ${MAX_ELEMENTS} elements ` +
      `(got ${elements.length}); export subsets and split those instead.`
    );
  }

  const n = elements.length;
  const parent = new Array<number>(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    let cur = i;
    while (parent[cur] !== cur) {
      const root = parent[parent[cur] as number] as number;
      parent[cur] = root;
      cur = root;
    }
    return cur;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const boxes = elements.map(elementBox);
  for (let i = 0; i < n; i++) {
    const a = boxes[i] as Box;
    for (let j = i + 1; j < n; j++) {
      const b = boxes[j] as Box;
      if (
        a.x1 - margin < b.x2 && b.x1 - margin < a.x2 &&
        a.y1 - margin < b.y2 && b.y1 - margin < a.y2
      ) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(i);
    groups.set(root, list);
  }

  const clusters: SceneCluster[] = [];
  for (const indices of groups.values()) {
    if (indices.length < minElements) continue;
    const members = indices.map(i => elements[i] as Record<string, any>);
    let bounds = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
    for (const el of members) {
      const b = elementBox(el);
      bounds = {
        x1: Math.min(bounds.x1, b.x1), y1: Math.min(bounds.y1, b.y1),
        x2: Math.max(bounds.x2, b.x2), y2: Math.max(bounds.y2, b.y2)
      };
    }
    const texts = members.filter(el => el.type === 'text' && typeof el.text === 'string' && el.text.trim() !== '');
    const prominent = texts.length > 0
      ? texts.reduce((best, el) => (Number(el.fontSize) || 20) > (Number(best.fontSize) || 20) ? el : best)
      : null;
    clusters.push({
      name: sanitizeName(prominent ? String(prominent.text) : 'cluster'),
      elementIds: members.map(el => String(el.id)),
      count: members.length,
      bounds
    });
  }

  // Stable left-to-right order, then deduplicate names.
  clusters.sort((a, b) => a.bounds.x1 - b.bounds.x1 || a.bounds.y1 - b.bounds.y1);
  const seen = new Map<string, number>();
  for (const cluster of clusters) {
    const used = seen.get(cluster.name) ?? 0;
    seen.set(cluster.name, used + 1);
    if (used > 0) cluster.name = `${cluster.name}-${used + 1}`;
  }
  return clusters;
}
