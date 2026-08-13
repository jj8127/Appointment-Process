export type SampleRevenueRawNode = {
  id: string;
  parentId: string | null;
  name: string;
  affiliation: string;
  salesKrw: number;
};

export type SampleRevenueGraphNode = SampleRevenueRawNode & {
  depth: number;
  pathNames: string[];
  isViewer: boolean;
  eligible: boolean;
  expectedAllocationKrw: number;
};

export type SampleRevenueGraphEdge = {
  id: string;
  source: string;
  target: string;
};

export type SampleRevenueGraphSummary = {
  eligibleContributorCount: number;
  eligibleSalesKrw: number;
  expectedAllocationKrw: number;
  excludedContributorCount: number;
};

export type SampleRevenueGraphModel = {
  nodes: SampleRevenueGraphNode[];
  edges: SampleRevenueGraphEdge[];
  summary: SampleRevenueGraphSummary;
};

export type SampleRevenueDepthFilter =
  | 'all'
  | '1-3'
  | '4-6'
  | '7-10';
