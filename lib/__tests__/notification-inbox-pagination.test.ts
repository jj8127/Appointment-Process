import { collectVisibleNotificationInboxRows } from '../../supabase/functions/_shared/notification-inbox-pagination';

type Row = {
  id: number;
  dismissed: boolean;
};

describe('notification inbox pagination', () => {
  it('pages past dismissed rows before applying the visible-item limit', async () => {
    const rows: Row[] = [
      ...Array.from({ length: 100 }, (_, index) => ({
        id: index + 1,
        dismissed: true,
      })),
      ...Array.from({ length: 8 }, (_, index) => ({
        id: index + 101,
        dismissed: false,
      })),
    ];
    const fetchPage = jest.fn(async (offset: number, pageSize: number) =>
      rows.slice(offset, offset + pageSize));

    await expect(collectVisibleNotificationInboxRows({
      limit: 100,
      pageSize: 100,
      fetchPage,
      selectVisible: async (page) => page.filter((row) => !row.dismissed),
    })).resolves.toEqual(rows.slice(100));

    expect(fetchPage).toHaveBeenNthCalledWith(1, 0, 100);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 100, 100);
    expect(fetchPage).toHaveBeenNthCalledWith(3, 108, 100);
  });

  it('does not treat a server-capped short page as source exhaustion', async () => {
    const fetchPage = jest
      .fn<Promise<Row[]>, [number, number]>()
      .mockResolvedValueOnce(
        Array.from({ length: 50 }, (_, index) => ({
          id: index + 1,
          dismissed: true,
        })),
      )
      .mockResolvedValueOnce([{ id: 51, dismissed: false }])
      .mockResolvedValueOnce([]);

    await expect(collectVisibleNotificationInboxRows({
      limit: 10,
      pageSize: 100,
      fetchPage,
      selectVisible: async (page) => page.filter((row) => !row.dismissed),
    })).resolves.toEqual([{ id: 51, dismissed: false }]);

    expect(fetchPage).toHaveBeenNthCalledWith(2, 50, 100);
    expect(fetchPage).toHaveBeenNthCalledWith(3, 51, 100);
  });

  it('stops once the visible limit is filled', async () => {
    const rows: Row[] = Array.from({ length: 300 }, (_, index) => ({
      id: index + 1,
      dismissed: false,
    }));
    const fetchPage = jest.fn(async (offset: number, pageSize: number) =>
      rows.slice(offset, offset + pageSize));

    const result = await collectVisibleNotificationInboxRows({
      limit: 80,
      pageSize: 100,
      fetchPage,
      selectVisible: async (page) => page,
    });

    expect(result).toHaveLength(80);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
