export type FcBasicInformationProfile = {
  id: string;
  affiliation: string | null;
  name: string | null;
  phone: string | null;
  recommender: string | null;
  email: string | null;
  temp_id: string | null;
  carrier: string | null;
  address: string | null;
  address_detail: string | null;
  resident_id_masked: string | null;
  signup_completed: boolean | null;
};

export type FcBasicInformationFormValues = {
  affiliation: string;
  name: string;
  phone: string;
  email: string;
  carrier: string;
  address: string;
  addressDetail: string;
  residentFront: string;
  residentBack: string;
};

export type FcBasicInformationPatch = Partial<
  Pick<FcBasicInformationFormValues, 'affiliation' | 'name' | 'email' | 'carrier'>
>;

const cleanText = (value: string | null | undefined) => String(value ?? '').trim();

export function buildFcBasicInformationFormValues(
  profile: FcBasicInformationProfile,
): FcBasicInformationFormValues {
  return {
    affiliation: cleanText(profile.affiliation),
    name: cleanText(profile.name),
    phone: cleanText(profile.phone),
    email: cleanText(profile.email),
    carrier: cleanText(profile.carrier),
    address: cleanText(profile.address),
    addressDetail: cleanText(profile.address_detail),
    residentFront: '',
    residentBack: '',
  };
}

export function buildFcBasicInformationPatch(
  current: FcBasicInformationProfile,
  next: Pick<FcBasicInformationFormValues, 'affiliation' | 'name' | 'email' | 'carrier'>
    & Partial<FcBasicInformationFormValues>,
): FcBasicInformationPatch {
  const patch: FcBasicInformationPatch = {};
  const editableFields = ['affiliation', 'name', 'email', 'carrier'] as const;

  for (const field of editableFields) {
    if (cleanText(current[field]) !== cleanText(next[field])) {
      patch[field] = cleanText(next[field]);
    }
  }

  return patch;
}
