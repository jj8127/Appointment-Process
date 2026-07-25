type ReferralPermissionDisplayInput = {
  role: 'admin' | 'manager' | 'fc' | null;
  isReadOnly: boolean;
  serverCanMutate: boolean | undefined;
};

export function resolveReferralPermissionDisplay({
  role,
  isReadOnly,
  serverCanMutate,
}: ReferralPermissionDisplayInput) {
  const permissionResolved = typeof serverCanMutate === 'boolean';
  const showMutateControls =
    permissionResolved
    && role === 'admin'
    && !isReadOnly
    && serverCanMutate;

  return {
    showMutateControls,
    showReadOnlyState: permissionResolved && !showMutateControls,
  };
}
