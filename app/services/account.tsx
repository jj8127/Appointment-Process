import { Redirect } from 'expo-router';

import BrandedLoadingState from '@/components/BrandedLoadingState';
import { useSession } from '@/hooks/use-session';

export default function ServiceAccount() {
  const { hydrated, role } = useSession();
  if (!hydrated) return <BrandedLoadingState />;
  return <Redirect href={role ? '/settings?surface=service-hub' : '/login'} />;
}
