import type { MessengerLoadingVariant } from '@/lib/messenger-loading';
import BrandedLoadingState from './BrandedLoadingState';

type Props = {
  variant: MessengerLoadingVariant;
  layout?: 'screen' | 'section';
};

export default function MessengerLoadingState({ variant, layout = 'screen' }: Props) {
  return <BrandedLoadingState variant={variant} layout={layout} />;
}
