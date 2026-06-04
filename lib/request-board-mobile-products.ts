export type RequestBoardProductSource = {
  id: number;
  name: string;
  icon?: string | null;
};

export type MobileRequestProduct = {
  id: number;
  name: string;
  icon?: string | null;
};

type MobileProductConfig = {
  name: string;
  aliases: string[];
};

const MOBILE_PRODUCT_CONFIG: MobileProductConfig[] = [
  { name: '종신보험', aliases: ['종신보험'] },
  { name: '건강보험', aliases: ['건강보험'] },
  { name: '재가보험', aliases: ['재가보험'] },
  { name: '간병보험', aliases: ['간병보험'] },
  { name: '고고당대통', aliases: ['고고당대통'] },
  { name: '운전자보험', aliases: ['운전자보험'] },
  { name: '실비보험', aliases: ['실비보험', '의료비보험', '실손보험'] },
  { name: '연금보험', aliases: ['연금보험', '저축보험', '저축 연금', '저축연금', '저축/연금 보험'] },
];

export const GARMIN_REQUEST_PRODUCT_NAMES = MOBILE_PRODUCT_CONFIG.map((product) => product.name);

const normalizeProductName = (value: string): string =>
  value.replace(/\s+/g, '').replace(/[\/]/g, '').trim();

const configAliasKeys = (config: MobileProductConfig) =>
  [config.name, ...config.aliases].map(normalizeProductName);

export const resolveMobileRequestProductName = (name: string): string | null => {
  const normalized = normalizeProductName(name);

  for (const config of MOBILE_PRODUCT_CONFIG) {
    const aliases = configAliasKeys(config);
    if (aliases.includes(normalized) || aliases.some((alias) => alias && normalized.includes(alias))) {
      return config.name;
    }
  }

  return null;
};

const resolveAliasRank = (displayName: string, sourceName: string): number => {
  const config = MOBILE_PRODUCT_CONFIG.find((item) => item.name === displayName);
  if (!config) return Number.MAX_SAFE_INTEGER;
  const aliases = configAliasKeys(config);
  const source = normalizeProductName(sourceName);
  const index = aliases.indexOf(source);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
};

export const mapRequestBoardProductsToMobileCatalog = (
  products: readonly RequestBoardProductSource[],
): { products: MobileRequestProduct[]; productIdAliasMap: Record<number, number> } => {
  const grouped = new Map<string, RequestBoardProductSource[]>();
  const productIdAliasMap: Record<number, number> = {};

  products.forEach((product) => {
    const displayName = resolveMobileRequestProductName(product.name);
    if (!displayName) return;
    const current = grouped.get(displayName) ?? [];
    current.push(product);
    grouped.set(displayName, current);
  });

  const mobileProducts = MOBILE_PRODUCT_CONFIG.flatMap((config) => {
    const group = grouped.get(config.name) ?? [];
    if (group.length === 0) return [];

    const canonical = [...group].sort((a, b) => {
      const aliasRankA = resolveAliasRank(config.name, a.name);
      const aliasRankB = resolveAliasRank(config.name, b.name);
      if (aliasRankA !== aliasRankB) return aliasRankA - aliasRankB;
      return a.id - b.id;
    })[0];

    group.forEach((product) => {
      productIdAliasMap[product.id] = canonical.id;
    });

    return [{
      id: canonical.id,
      name: config.name,
      icon: canonical.icon,
    }];
  });

  return { products: mobileProducts, productIdAliasMap };
};
