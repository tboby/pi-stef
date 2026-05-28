export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  priority?: "high" | "medium" | "low";
}

export interface SkillMeta {
  name: string;
  description?: string;
  path: string;
}
