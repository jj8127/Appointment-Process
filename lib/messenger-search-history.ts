import {
  isSafeRecentSearchQuery,
  normalizeMessengerSearchQuery,
} from './messenger-search-model';

export const MESSENGER_SEARCH_HISTORY_LIMIT = 10;

export type MessengerSearchHistorySnapshot = {
  actorKey: string | null;
  saveEnabled: boolean;
  queries: string[];
};

export class MessengerSearchHistory {
  private actorKey: string | null = null;
  private saveEnabled = true;
  private queries: string[] = [];

  setActor(actorKey: string | null): MessengerSearchHistorySnapshot {
    const normalizedActor = typeof actorKey === 'string' && actorKey.trim()
      ? actorKey.trim()
      : null;
    if (normalizedActor !== this.actorKey) {
      this.actorKey = normalizedActor;
      this.queries = [];
    }
    return this.snapshot();
  }

  setSaveEnabled(enabled: boolean): MessengerSearchHistorySnapshot {
    this.saveEnabled = enabled;
    return this.snapshot();
  }

  add(rawQuery: string): MessengerSearchHistorySnapshot {
    const query = normalizeMessengerSearchQuery(rawQuery);
    if (!this.actorKey || !this.saveEnabled || !isSafeRecentSearchQuery(query)) {
      return this.snapshot();
    }
    this.queries = [query, ...this.queries.filter((item) => item !== query)]
      .slice(0, MESSENGER_SEARCH_HISTORY_LIMIT);
    return this.snapshot();
  }

  remove(query: string): MessengerSearchHistorySnapshot {
    const normalized = normalizeMessengerSearchQuery(query);
    this.queries = this.queries.filter((item) => item !== normalized);
    return this.snapshot();
  }

  clear(): MessengerSearchHistorySnapshot {
    this.queries = [];
    return this.snapshot();
  }

  snapshot(): MessengerSearchHistorySnapshot {
    return {
      actorKey: this.actorKey,
      saveEnabled: this.saveEnabled,
      queries: [...this.queries],
    };
  }
}

export const messengerSearchHistory = new MessengerSearchHistory();
