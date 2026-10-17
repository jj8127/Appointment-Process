import type { ReactNode } from 'react';
import { Modal, type ModalProps } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';

type Props = Omit<ModalProps, 'children' | 'statusBarTranslucent' | 'navigationBarTranslucent'> & {
  children: (insets: EdgeInsets) => ReactNode;
};

function ModalInsets({ children }: Pick<Props, 'children'>) {
  return <>{children(useSafeAreaInsets())}</>;
}

/**
 * A modal window drawn under the system bars. The screen's safe-area insets do not
 * describe a modal window, so the content receives insets measured inside the modal.
 */
export function SystemBarsModal({ children, ...props }: Props) {
  return (
    <Modal {...props} statusBarTranslucent navigationBarTranslucent>
      <SafeAreaProvider>
        <ModalInsets>{children}</ModalInsets>
      </SafeAreaProvider>
    </Modal>
  );
}
