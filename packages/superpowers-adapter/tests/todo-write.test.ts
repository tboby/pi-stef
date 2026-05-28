import { describe, it, expect, beforeEach } from "vitest";
import { createMockAPI, executeTool, getToolByName } from "./helpers/mock-api.js";
import { registerTodoWriteTool, formatTodos, clearTodos } from "../src/tools/todo-write.js";

describe("TodoWrite tool", () => {
  let mockApi: ReturnType<typeof createMockAPI>;

  beforeEach(() => {
    mockApi = createMockAPI();
    clearTodos();
    registerTodoWriteTool(mockApi as any);
  });

  it("registers the tool", () => {
    const tool = getToolByName(mockApi, "TodoWrite");
    expect(tool).toBeDefined();
    expect(tool!.label).toBe("TodoWrite");
    expect(tool!.description).toContain("todo");
  });

  it("creates todos from empty state", async () => {
    const result = await executeTool(mockApi, "TodoWrite", {
      todos: [
        { id: "1", content: "Design API", status: "pending" },
        { id: "2", content: "Write tests", status: "in_progress" },
        { id: "3", content: "Ship it", status: "completed" },
      ],
    }) as any;

    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("1/3 completed");
    expect(result.content[0].text).toContain("Design API");
    expect(result.details.todoCount).toBe(3);
  });

  it("replaces existing todos", async () => {
    await executeTool(mockApi, "TodoWrite", {
      todos: [{ id: "1", content: "First", status: "pending" }],
    });

    const result = await executeTool(mockApi, "TodoWrite", {
      todos: [{ id: "2", content: "Second", status: "completed" }],
    }) as any;

    expect(result.details.todoCount).toBe(1);
    expect(result.content[0].text).toContain("Second");
    expect(result.content[0].text).not.toContain("First");
  });

  it("handles priority field", async () => {
    const result = await executeTool(mockApi, "TodoWrite", {
      todos: [
        { id: "1", content: "Urgent", status: "pending", priority: "high" },
        { id: "2", content: "Normal", status: "pending" },
      ],
    }) as any;

    expect(result.content[0].text).toContain("[HIGH]");
    expect(result.content[0].text).toContain("Urgent");
  });

  it("shows empty state message when no todos", () => {
    const text = formatTodos();
    expect(text).toBe("No todos. Use TodoWrite to create tasks.");
  });

  it("shows progress count", async () => {
    await executeTool(mockApi, "TodoWrite", {
      todos: [
        { id: "1", content: "Done", status: "completed" },
        { id: "2", content: "Pending", status: "pending" },
        { id: "3", content: "Active", status: "in_progress" },
      ],
    });

    const text = formatTodos();
    expect(text).toContain("1/3 completed");
  });
});
