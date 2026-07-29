export type NotificationInboxPageCollectorOptions<Row> = {
  limit: number;
  pageSize: number;
  fetchPage(offset: number, pageSize: number): Promise<Row[]>;
  selectVisible(rows: Row[]): Promise<Row[]>;
};

export async function collectVisibleNotificationInboxRows<Row>({
  limit,
  pageSize,
  fetchPage,
  selectVisible,
}: NotificationInboxPageCollectorOptions<Row>): Promise<Row[]> {
  const safeLimit = Math.max(1, Math.floor(limit));
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const visibleRows: Row[] = [];
  let offset = 0;

  while (visibleRows.length < safeLimit) {
    const page = await fetchPage(offset, safePageSize);
    if (page.length === 0) break;

    const selectedRows = await selectVisible(page);
    visibleRows.push(...selectedRows.slice(0, safeLimit - visibleRows.length));

    offset += page.length;
  }

  return visibleRows;
}
