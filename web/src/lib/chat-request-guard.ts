type RequestTicket = { generation: number; revision: number; sequence: number };

/** Scope asynchronous work to one mounted account and conversation. */
export function createChatRequestGuard() {
  let controller = new AbortController();
  let generation = 0;
  let revision = 0;
  let sequence = 0;
  const snapshot = (): RequestTicket => ({ generation, revision, sequence });
  return {
    get signal() { return controller.signal; },
    activate() {
      controller.abort();
      controller = new AbortController();
      generation += 1;
    },
    dispose() { controller.abort(); generation += 1; },
    snapshot,
    changed() { revision += 1; },
    beginList() { sequence += 1; return snapshot(); },
    isCurrent(ticket: RequestTicket) {
      return !controller.signal.aborted && ticket.generation === generation;
    },
    isLatestList(ticket: RequestTicket) {
      return this.isCurrent(ticket) && ticket.sequence === sequence;
    },
    canApplyList(ticket: RequestTicket) {
      return this.isLatestList(ticket) && ticket.revision === revision;
    },
  };
}
