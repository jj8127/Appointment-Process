declare module 'd3-force' {
  export interface Force<NodeDatum = unknown> {
    (alpha: number): void;
    initialize?(nodes: NodeDatum[], random?: () => number): void;
  }

  export interface ForceCollide<NodeDatum = unknown> {
    (alpha: number): void;
    initialize?(nodes: NodeDatum[], random?: () => number): void;
    radius(value: number | ((node: NodeDatum) => number)): ForceCollide<NodeDatum>;
    strength(value: number): ForceCollide<NodeDatum>;
    iterations(value: number): ForceCollide<NodeDatum>;
  }

  export interface ForceManyBody<NodeDatum = unknown> extends Force<NodeDatum> {
    strength(value: number | ((node: NodeDatum, index: number, nodes: NodeDatum[]) => number)): ForceManyBody<NodeDatum>;
    distanceMin(value: number): ForceManyBody<NodeDatum>;
    distanceMax(value: number): ForceManyBody<NodeDatum>;
  }

  export interface ForceLink<NodeDatum = unknown, LinkDatum = unknown> extends Force<NodeDatum> {
    id(value: (node: NodeDatum, index: number, nodes: NodeDatum[]) => string): ForceLink<NodeDatum, LinkDatum>;
    distance(value: number | ((link: LinkDatum, index: number, links: LinkDatum[]) => number)): ForceLink<NodeDatum, LinkDatum>;
    strength(value: number | ((link: LinkDatum, index: number, links: LinkDatum[]) => number)): ForceLink<NodeDatum, LinkDatum>;
    iterations(value: number): ForceLink<NodeDatum, LinkDatum>;
  }

  export interface ForcePosition<NodeDatum = unknown> extends Force<NodeDatum> {
    strength(value: number | ((node: NodeDatum, index: number, nodes: NodeDatum[]) => number)): ForcePosition<NodeDatum>;
  }

  export function forceCollide<NodeDatum = unknown>(): ForceCollide<NodeDatum>;
  export function forceManyBody<NodeDatum = unknown>(): ForceManyBody<NodeDatum>;
  export function forceLink<NodeDatum = unknown, LinkDatum = unknown>(links?: LinkDatum[]): ForceLink<NodeDatum, LinkDatum>;
  export function forceX<NodeDatum = unknown>(x?: number | ((node: NodeDatum, index: number, nodes: NodeDatum[]) => number)): ForcePosition<NodeDatum>;
  export function forceY<NodeDatum = unknown>(y?: number | ((node: NodeDatum, index: number, nodes: NodeDatum[]) => number)): ForcePosition<NodeDatum>;
}
