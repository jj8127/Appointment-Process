import { CareerType, DocumentType, RequiredDoc } from '@/types/fc';

const baseDocs: DocumentType[] = [
  '생명보험 합격증',
  '손해보험 합격증',
  '제3보험 합격증',
  '이클린',
  '경력증명서',
];

const trainingDocs: Record<CareerType, DocumentType[]> = {
  신입: ['생명보험 이수증(신입)', '손해보험 이수증(신입)', '제3보험 이수증(신입)'],
  경력: ['생명보험 이수증(경력)', '손해보험 이수증(경력)', '제3보험 이수증(경력)'],
};

export function getRequiredDocs(careerType: CareerType): RequiredDoc[] {
  return [
    ...baseDocs.map((type) => ({ type, required: true })),
    ...trainingDocs[careerType].map((type) => ({ type, required: true })),
  ];
}
