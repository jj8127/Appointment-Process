import type { StaffType } from './staff-identity';

export type MessengerHubRoleInput = {
  role: 'admin' | 'fc' | null;
  readOnly?: boolean;
  staffType?: StaffType;
  isRequestBoardDesigner?: boolean;
};

export type MessengerHubCapabilities = {
  internalPeopleSource: 'fc-targets' | 'internal-list' | 'none';
  canUseGroupChat: boolean;
  canReadRequestBoard: boolean;
  canLoadRequestBoardDirectory: boolean;
  canCreateRequestBoardDm: boolean;
};

export function getMessengerHubCapabilities(
  input: MessengerHubRoleInput,
): MessengerHubCapabilities {
  if (!input.role) {
    return {
      internalPeopleSource: 'none',
      canUseGroupChat: false,
      canReadRequestBoard: false,
      canLoadRequestBoardDirectory: false,
      canCreateRequestBoardDm: false,
    };
  }

  const isDesigner = Boolean(input.isRequestBoardDesigner);
  const isPlainAdmin = input.role === 'admin'
    && !input.readOnly
    && input.staffType !== 'developer';
  const isDeveloper = input.role === 'admin' && input.staffType === 'developer';
  const canReadRequestBoard = !isPlainAdmin;
  const canCreateRequestBoardDm = canReadRequestBoard && !input.readOnly;

  return {
    internalPeopleSource:
      input.role === 'fc' && !isDesigner ? 'fc-targets' : 'internal-list',
    canUseGroupChat: !isDesigner && (input.role === 'fc' || input.role === 'admin'),
    canReadRequestBoard,
    // Developers can still open existing GaramLink rooms, but loading its
    // complete directory into the GaramIn people tab makes that tab stall.
    canLoadRequestBoardDirectory: canCreateRequestBoardDm && !isDeveloper,
    canCreateRequestBoardDm,
  };
}
