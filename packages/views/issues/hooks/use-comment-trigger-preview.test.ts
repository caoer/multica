import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@multica/core/api";
import {
  commentTriggerPreviewSignature,
  useCommentTriggerPreview,
} from "./use-comment-trigger-preview";

vi.mock("@multica/core/api", () => ({
  api: {
    previewCommentTriggers: vi.fn(),
  },
}));

const previewCommentTriggers = vi.mocked(api.previewCommentTriggers);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

async function advancePreviewDebounce() {
  act(() => {
    vi.advanceTimersByTime(300);
  });
  await act(async () => {});
}

describe("useCommentTriggerPreview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    previewCommentTriggers.mockResolvedValue({ agents: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    previewCommentTriggers.mockReset();
  });

  it("debounces preview and sends the latest content for an unchanged signature", async () => {
    const { rerender } = renderHook(
      ({ content }) => useCommentTriggerPreview({ issueId: "issue-1", content }),
      {
        wrapper: createWrapper(),
        initialProps: { content: "hello" },
      },
    );

    rerender({ content: "hello with more ordinary text" });
    expect(previewCommentTriggers).not.toHaveBeenCalled();

    await advancePreviewDebounce();

    expect(previewCommentTriggers).toHaveBeenCalledTimes(1);
    expect(previewCommentTriggers).toHaveBeenCalledWith(
      "issue-1",
      "hello with more ordinary text",
      undefined,
    );
  });

  it("uses the TanStack Query cache when the debounced signature repeats", async () => {
    const agentA = "00000000-0000-0000-0000-000000000001";
    const content = `[@A](mention://agent/${agentA})`;
    const { rerender } = renderHook(
      ({ content }) => useCommentTriggerPreview({ issueId: "issue-1", content }),
      {
        wrapper: createWrapper(),
        initialProps: { content },
      },
    );

    await advancePreviewDebounce();
    expect(previewCommentTriggers).toHaveBeenCalledTimes(1);

    rerender({ content: "" });
    rerender({ content });
    await advancePreviewDebounce();

    expect(previewCommentTriggers).toHaveBeenCalledTimes(1);
  });

  it("fetches again when routing mention tokens change", async () => {
    const agentA = "00000000-0000-0000-0000-000000000001";
    const agentB = "00000000-0000-0000-0000-000000000002";
    const { rerender } = renderHook(
      ({ content }) => useCommentTriggerPreview({ issueId: "issue-1", content }),
      {
        wrapper: createWrapper(),
        initialProps: { content: `[@A](mention://agent/${agentA})` },
      },
    );

    await advancePreviewDebounce();
    expect(previewCommentTriggers).toHaveBeenCalledTimes(1);

    rerender({ content: `[@A](mention://agent/${agentA}) [@B](mention://agent/${agentB})` });
    await advancePreviewDebounce();

    expect(previewCommentTriggers).toHaveBeenCalledTimes(2);
  });
});

describe("commentTriggerPreviewSignature", () => {
  it("ignores ordinary text changes", () => {
    expect(commentTriggerPreviewSignature("hello")).toBe(
      commentTriggerPreviewSignature("hello with more ordinary text"),
    );
  });

  it("changes when routing mentions change", () => {
    const agentA = "00000000-0000-0000-0000-000000000001";
    const agentB = "00000000-0000-0000-0000-000000000002";

    expect(commentTriggerPreviewSignature(`[@A](mention://agent/${agentA})`)).not.toBe(
      commentTriggerPreviewSignature(`[@A](mention://agent/${agentA}) [@B](mention://agent/${agentB})`),
    );
  });

  it("tracks @all but ignores issue cross-references", () => {
    const issueID = "00000000-0000-0000-0000-000000000003";

    expect(commentTriggerPreviewSignature(`See [MUL-1](mention://issue/${issueID})`)).toBe(
      commentTriggerPreviewSignature("plain text"),
    );
    expect(commentTriggerPreviewSignature("[@all](mention://all/all)")).not.toBe(
      commentTriggerPreviewSignature("plain text"),
    );
  });
});
