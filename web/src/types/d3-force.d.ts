declare module 'd3-force' {
  export interface ForceCollide<NodeDatum = unknown> {
    (alpha: number): void;
    initialize?(nodes: NodeDatum[], random?: () => number): void;
    radius(value: number | ((node: NodeDatum) => number)): ForceCollide<NodeDatum>;
    strength(value: number): ForceCollide<NodeDatum>;
    iterations(value: number): ForceCollide<NodeDatum>;
  }

  export function forceCollide<NodeDatum = unknown>(): ForceCollide<NodeDatum>;
}
