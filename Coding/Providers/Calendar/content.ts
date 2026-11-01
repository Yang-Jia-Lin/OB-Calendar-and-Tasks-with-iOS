import { comparableEventContent, sameEvent, type CalendarEvent } from "../../Shared/contracts";
export function calendarContent(event:CalendarEvent){const c=comparableEventContent(event);for(const key of ["description","location","rrule","timezone"] as const)if(c[key]===""||c[key]==null)delete c[key];if(c.isTask){c.completed=!!c.completed;delete c.due;}return c;}
export const sameCalendarContent=(a:CalendarEvent,b:CalendarEvent)=>sameEvent(calendarContent(a),calendarContent(b));
