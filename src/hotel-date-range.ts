export const resolveHotelDateRangeSelection = (firstDate: string, nextDate: string) => nextDate > firstDate
  ? { checkIn: firstDate, checkOut: nextDate, complete: true }
  : { checkIn: nextDate, checkOut: "", complete: false };
