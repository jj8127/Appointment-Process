import {
  GARMIN_REQUEST_PRODUCT_NAMES,
  mapRequestBoardProductsToMobileCatalog,
  resolveMobileRequestProductName,
} from '@/lib/request-board-mobile-products';

describe('request board mobile product catalog', () => {
  it('keeps the preferred GaramLink categories first for GaramIn request creation', () => {
    expect(GARMIN_REQUEST_PRODUCT_NAMES).toEqual([
      '종신보험',
      '건강보험',
      '재가보험',
      '간병보험',
      '고고당대통',
      '운전자보험',
      '실비보험',
      '연금보험',
    ]);
  });

  it('maps GaramLink legacy product aliases into the mobile categories', () => {
    expect(resolveMobileRequestProductName('의료비보험')).toBe('실비보험');
    expect(resolveMobileRequestProductName('실손보험')).toBe('실비보험');
    expect(resolveMobileRequestProductName('저축보험')).toBe('연금보험');
    expect(resolveMobileRequestProductName('저축/연금 보험')).toBe('연금보험');
    expect(resolveMobileRequestProductName('암보험')).toBe('암보험');
  });

  it('deduplicates API products by mobile display name while preserving additional canonical products', () => {
    const model = mapRequestBoardProductsToMobileCatalog([
      { id: 8, name: '종신보험', icon: 'life' },
      { id: 6, name: '건강보험', icon: 'health' },
      { id: 2, name: '의료비보험', icon: 'medical-a' },
      { id: 21, name: '실손보험', icon: 'medical-b' },
      { id: 30, name: '연금보험', icon: 'pension-a' },
      { id: 20, name: '저축보험', icon: 'pension-b' },
      { id: 99, name: '암보험', icon: 'cancer' },
    ]);

    expect(model.products.map((product) => [product.id, product.name])).toEqual([
      [8, '종신보험'],
      [6, '건강보험'],
      [2, '실비보험'],
      [30, '연금보험'],
      [99, '암보험'],
    ]);
    expect(model.productIdAliasMap).toEqual({
      2: 2,
      6: 6,
      8: 8,
      20: 30,
      21: 2,
      30: 30,
      99: 99,
    });
  });
});
