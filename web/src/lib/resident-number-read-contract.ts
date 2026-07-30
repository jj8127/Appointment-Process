export type ResidentNumberMap = Record<string, string | null>;
export type ResidentNumberReadStatus = 'ready' | 'missing' | 'unavailable';
export type ResidentNumberStatusMap = Record<string, ResidentNumberReadStatus>;

export type ResidentNumberReadResult = {
  residentNumbers: ResidentNumberMap;
  residentNumberStatuses: ResidentNumberStatusMap;
};
