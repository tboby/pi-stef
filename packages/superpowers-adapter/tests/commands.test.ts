import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockAPI } from "./helpers/mock-api.js";
import { registerTodoWriteTool, clearTodos } from "../src/tools/todo-write.js";
import { registerCommands } from "../src/commands.js";

describe("commands", () => {
  let mockApi: ReturnType<typeof createMockAPI>;

  beforeEach(() => {
    mockApi = createMockAPI();
    clearTodos();
    registerTodoWriteTool(mockApi as any);
    registerCommands(mockApi as any);
  });

  it("registers /todos command", () => {
    expect(mockApi.commands.has("todos")).toBe(true);
    expect(mockApi.commands.get("todos")!.description).toBe("Show current todo list");
  });

  it("registers /todo-clear command", () => {
    expect(mockApi.commands.has("todo-clear")).toBe(true);
    expect(mockApi.commands.get("todo-clear")!.description).toBe("Clear all todos");
  });

  it("/todos displays empty message when no todos", async () => {
    const mockCtx = { ui: { notify: vi.fn() } };
    const handler = mockApi.commands.get("todos")!.handler;
    await handler("", mockCtx);
    expect(mockCtx.ui.notify).toHaveBeenCalledWith(
      "No todos. Use TodoWrite to create tasks.",
      "info",
    );
  });

  it("/todos displays formatted list", async () => {
    const tool = mockApi.tools.find((t) => t.name === "TodoWrite")!;
    await tool.execute("", {
      todos: [
        { id: "1", content: "Task A", status: "completed" },
        { id: "2", content: "Task B", status: "in_progress" },
        { id: "3", content: "Task C", status: "pending" },
      ],
    });

    const mockCtx = { ui: { notify: vi.fn() } };
    const handler = mockApi.commands.get("todos")!.handler;
    await handler("", mockCtx);

    const notification = mockCtx.ui.notify.mock.calls[0][0] as string;
    expect(notification).toContain("1/3 completed");
    expect(notification).toContain("Task A");
    expect(notification).toContain("🔄");
  });

  it("/todo-clear resets todos", async () => {
    const tool = mockApi.tools.find((t) => t.name === "TodoWrite")!;
    await tool.execute("", {
      todos: [{ id: "1", content: "To be cleared", status: "pending" }],
    });

    const mockCtx = { ui: { notify: vi.fn() } };
    await mockApi.commands.get("todo-clear")!.handler("", mockCtx);
    expect(mockCtx.ui.notify).toHaveBeenCalledWith("All todos cleared.", "info");
  });
});
