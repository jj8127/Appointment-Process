import { findMessengerReadLineId } from '../messenger-read-line';

type Row = { id: string; incoming: boolean; read: boolean };
const unreadIncoming = (m: Row) => m.incoming && !m.read;

describe('read line position', () => {
  it('sits above the oldest unread incoming message (newest-first input)', () => {
    const rows: Row[] = [
      { id: 'm5', incoming: true, read: false },
      { id: 'm4', incoming: true, read: false },
      { id: 'm3', incoming: false, read: false },
      { id: 'm2', incoming: true, read: true },
      { id: 'm1', incoming: false, read: true },
    ];
    expect(findMessengerReadLineId(rows, unreadIncoming)).toBe('m4');
  });

  it('is absent when nothing is unread or when the whole room is unread', () => {
    expect(findMessengerReadLineId([{ id: 'a', incoming: true, read: true }], unreadIncoming)).toBeNull();
    expect(findMessengerReadLineId([
      { id: 'b', incoming: true, read: false },
      { id: 'a', incoming: true, read: false },
    ], unreadIncoming)).toBeNull();
    expect(findMessengerReadLineId([], unreadIncoming)).toBeNull();
  });
});
