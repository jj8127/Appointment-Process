import { getBoardFileKind, splitBoardPostLead } from '@/lib/board-detail-layout';

describe('board post lead', () => {
  it('lifts the first paragraph above the attachments and keeps the rest as body', () => {
    expect(splitBoardPostLead('11월 1일부터 시책 기준이 바뀝니다.\n\n세부 기준은 첨부 표를 확인해주세요.\n문의는 지점으로.'))
      .toEqual({ lead: '11월 1일부터 시책 기준이 바뀝니다.', rest: '세부 기준은 첨부 표를 확인해주세요.\n문의는 지점으로.' });
  });

  it('uses the first line when the post has no blank lines, and a short post becomes the lead alone', () => {
    expect(splitBoardPostLead('마감: 10월 31일\r\n서류는 지점에 제출')).toEqual({ lead: '마감: 10월 31일', rest: '서류는 지점에 제출' });
    expect(splitBoardPostLead('  교육 장소가 3층으로 바뀌었습니다.  ')).toEqual({ lead: '교육 장소가 3층으로 바뀌었습니다.', rest: '' });
  });

  it('shows no lead when the opening paragraph is too long to be a summary, or the post is empty', () => {
    const long = '가'.repeat(161);
    expect(splitBoardPostLead(`${long}\n\n다음 문단`)).toEqual({ lead: '', rest: `${long}\n\n다음 문단` });
    expect(splitBoardPostLead('   ')).toEqual({ lead: '', rest: '' });
    expect(splitBoardPostLead(undefined)).toEqual({ lead: '', rest: '' });
  });

  it('drops placeholder text staff type just to post an attachment', () => {
    expect(splitBoardPostLead('.')).toEqual({ lead: '', rest: '' });
    expect(splitBoardPostLead(' - ')).toEqual({ lead: '', rest: '' });
    expect(splitBoardPostLead('.\n\n첨부 자료 확인 부탁드립니다'))
      .toEqual({ lead: '', rest: '.\n\n첨부 자료 확인 부탁드립니다' });
  });
});

describe('board attachment kind', () => {
  it('labels common documents by extension and falls back to the MIME type', () => {
    expect(getBoardFileKind('11월_시책표.PDF')).toBe('PDF');
    expect(getBoardFileKind('명단.xlsx')).toBe('XLS');
    expect(getBoardFileKind('교육자료.pptx')).toBe('PPT');
    expect(getBoardFileKind('안내문.hwp')).toBe('HWP');
    expect(getBoardFileKind('scan', 'application/pdf')).toBe('PDF');
    expect(getBoardFileKind('photo', 'image/jpeg')).toBe('IMG');
    expect(getBoardFileKind('readme.txt')).toBe('파일');
  });
});
