import { SegmentedControl, useMantineTheme } from '@mantine/core';

interface StatusToggleProps {
    value: string; // 'pending' | 'approved' (or similar)
    onChange: (value: string) => void;
    labelPending?: string;
    labelApproved?: string;
    readOnly?: boolean;
}

export function StatusToggle({
    value,
    onChange,
    labelPending = '미승인',
    labelApproved = '승인',
    readOnly = false,
}: StatusToggleProps) {
    const theme = useMantineTheme();

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
            value={value}
            onChange={onChange}
            readOnly={readOnly}
            radius="xl"
            size="xs"
            data={[
                { label: labelPending, value: 'pending' },
                { label: labelApproved, value: 'approved' },
            ]}
            styles={{
                root: {
                    backgroundColor: '#f1f3f5', // gray.1
                    opacity: readOnly ? 0.6 : 1,
                },
                indicator: {
                    backgroundColor: value === 'approved' ? '#fff' : '#fff', // Always white pill
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                },
                label: {
                    fontWeight: 600,
                    color: value === 'approved'
                        ? '#212529' // Active Approved -> Dark
                        : '#868e96', // Inactive -> Gray
                }
                // We might need dynamic styling based on WHICH one is active to color text differently
                // e.g. Approved -> Green text? Pending -> Red text?
                // User image: "미접수" (Text is Red-ish/Orange), "접수 완료" (Text is Blue/Black)
                // Let's try to infer color.
            }}
            color={value === 'approved' ? 'green' : 'gray'} // This affects indicator color in some variants, but we overrode it.
        />
    );
}
