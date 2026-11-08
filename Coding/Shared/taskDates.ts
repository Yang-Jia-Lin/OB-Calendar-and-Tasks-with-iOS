import type {Task} from "./contracts";
import {dayKey} from "./time";
import {validDay} from "./scheduling";
/** Display overdue work today without rewriting its actual deadline or plan. */
export function taskOverdue(task:Task,today=dayKey()){
  return !task.completed&&((validDay(task.due)&&task.due<today)||(validDay(task.scheduledDate)&&task.scheduledDate<today));
}
export function taskDisplayDate(task:Task,today=dayKey()):string|null{
  if(task.completed)return null;
  return taskOverdue(task,today)||task.due===today?today:task.scheduledDate||null;
}
