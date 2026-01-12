import { SegmentedControl, useMantineTheme } from '@mantine/core';

interface StatusToggleProps {
    value: string; // 'pending' | 'approved' (or similar)
    onChange: (value: string) => void;
    labelPending?: string;
    labelApproved?: string;
    readOnly?: boolean;
    showNeutralForPending?: boolean;
    allowPendingPress?: boolean;
    isManagerMode?: boolean; // 본부장 모드 (색상 차별화용)
}

export function StatusToggle({
    value,
    onChange,
    labelPending = '미승인',
    labelApproved = '승인',
    readOnly = false,
    showNeutralForPending = false,
    allowPendingPress = false,
    isManagerMode = false,
}: StatusToggleProps) {
    const theme = useMantineTheme();
    const isNeutral = showNeutralForPending && value === 'pending';

    const handlePendingClick = () => {
        if (readOnly) return;
        if (allowPendingPress) {
            onChange('pending');
        }
    };

    // Map value to simple checked state for styling logic if needed, 
    // but SegmentedControl handles selection well.
    // We want specific colors:
    // Pending (Left): Gray text when selected? No, user image shows Gray bg for unselected, White pill for selected.
    // Actually standard SegmentedControl does this well.
    // User image: [미위촉 (Gray Pill)] [위촉 완료 (White Pill)]
    // We will use a semantic color mapping if possible, or just standard Mantine styles.
    // Let's stick to standard first, possibly with custom styles if needed to match "Image".
    // The image shows a pill container. Selected item is white.
    // Text colors might be important.

    return (
        <SegmentedControl
            value={value || 'pending'} // Safety fallback
            onChange={onChange}
            readOnly={readOnly}
            radius="xl"
            size="xs"
            data={[
                {
                    label: (
                        <span role="button" onClick={handlePendingClick}>
                            {labelPending}
                        </span>
                    ),
                    value: 'pending',
                },
                { label: labelApproved, value: 'approved' },
            ]}
            className="status-toggle"
            styles={{
                root: {
                    backgroundColor: isManagerMode ? '#e9ecef' : '#f1f3f5',
                    opacity: readOnly ? 0.6 : 1,
                    border: isManagerMode ? '1px solid #dee2e6' : undefined,
                },
                indicator: {
                    backgroundColor: isManagerMode ? '#e9ecef' : '#fff',
                    boxShadow: isManagerMode ? '0 1px 2px rgba(0,0,0,0.05)' : '0 1px 3px rgba(0,0,0,0.1)',
                    transition: 'transform 180ms ease, width 180ms ease, background-color 180ms ease, box-shadow 180ms ease',
                    opacity: isNeutral ? 0 : 1,
                },
                label: {
                    fontWeight: 600,
                    transition: 'color 180ms ease, transform 180ms ease',
                    color: isManagerMode ? theme.colors.gray[6] : (isNeutral ? theme.colors.gray[6] : undefined),
                },
                control: {
                    transition: 'color 180ms ease',
                },
            }}
        />
    );
}
