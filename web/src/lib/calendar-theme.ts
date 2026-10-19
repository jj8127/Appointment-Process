// Calendar headers follow the common picker layout: the clickable "2026년 10월 ▾" label on the left
// opens the year/month grid, and the previous/next arrows sit together on the right.
// The ▾ marker and hover state live in globals.css.
const CALENDAR_DEFAULTS = {
  defaultProps: {
    headerControlsOrder: ['level', 'previous', 'next'] as ('level' | 'previous' | 'next')[],
    monthLabelFormat: 'YYYY년 M월',
    yearLabelFormat: 'YYYY년',
  },
};

export const CALENDAR_THEME_COMPONENTS = {
  Calendar: CALENDAR_DEFAULTS,
  DatePicker: CALENDAR_DEFAULTS,
  DateInput: CALENDAR_DEFAULTS,
  DatePickerInput: CALENDAR_DEFAULTS,
  MonthPicker: CALENDAR_DEFAULTS,
  MonthPickerInput: CALENDAR_DEFAULTS,
};
