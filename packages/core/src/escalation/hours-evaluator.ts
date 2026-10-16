export interface DaySchedule {
  open: string; // "HH:MM" 24h
  close: string; // "HH:MM" 24h
  closed: boolean;
}

export type BusinessHoursMap = Record<string, DaySchedule>;

export interface HoursEvaluationResult {
  isOpen: boolean;
  dayOfWeek: string;
  currentTime: string;
  schedule?: DaySchedule;
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Checks whether the business is currently open based on tenant schedule and timezone.
 */
export function evaluateOperatingHours(
  businessHours: BusinessHoursMap,
  timezone: string = 'America/New_York',
  targetDate: Date = new Date()
): HoursEvaluationResult {
  // Format target date in tenant's timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(targetDate);
  const weekdayPart = parts.find(p => p.type === 'weekday')?.value.toLowerCase() || 'monday';
  const hourPart = parts.find(p => p.type === 'hour')?.value.padStart(2, '0') || '09';
  const minutePart = parts.find(p => p.type === 'minute')?.value.padStart(2, '0') || '00';

  const currentTime = `${hourPart}:${minutePart}`;
  const daySchedule = businessHours[weekdayPart];

  if (!daySchedule || daySchedule.closed) {
    return {
      isOpen: false,
      dayOfWeek: weekdayPart,
      currentTime,
      schedule: daySchedule,
    };
  }

  const isOpen = currentTime >= daySchedule.open && currentTime < daySchedule.close;

  return {
    isOpen,
    dayOfWeek: weekdayPart,
    currentTime,
    schedule: daySchedule,
  };
}
