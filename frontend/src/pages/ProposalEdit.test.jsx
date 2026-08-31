import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import ProposalEdit from "./ProposalEdit";
import { api } from "../lib/api";

const mockNavigate = jest.fn();

jest.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({}),
  useLocation: () => ({ state: null, pathname: "/proposals/new" }),
}), { virtual: true });

jest.mock("../lib/api", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
  },
  formatApiError: () => "Something went wrong.",
}));

jest.mock("../components/ui/button", () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));

jest.mock("../components/proposals/ProposalEditor", () => ({
  __esModule: true,
  default: ({ proposal, onChange, saveState }) => (
    <div>
      <span data-testid="save-state">{saveState}</span>
      <button type="button" onClick={() => onChange({ ...proposal, title: "Edited proposal" })}>
        Edit a field
      </button>
    </div>
  ),
}));

describe("new proposal persistence", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    api.get.mockResolvedValue({ data: [] });
    api.post.mockResolvedValue({
      data: {
        id: "created-proposal",
        title: "Edited proposal",
        status: "draft",
        version: 1,
      },
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test("does not create a draft until the first field is edited", async () => {
    await act(async () => {
      render(<ProposalEdit createNew />);
    });

    expect(screen.getByTestId("save-state")).toHaveTextContent("new");
    expect(api.post).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Edit a field" }));
    await act(async () => {
      jest.advanceTimersByTime(800);
      await Promise.resolve();
    });

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith(
      "/proposals",
      expect.objectContaining({ title: "Edited proposal" })
    );
  });
});
