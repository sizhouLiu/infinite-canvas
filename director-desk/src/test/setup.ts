import "@testing-library/jest-dom";
import { memoryPersistedStore } from "./memoryPersistedStorage";

vi.mock("../editor/store/directorPersistedStorage", () => import("./memoryPersistedStorage"));

beforeEach(() => {
  memoryPersistedStore.clear();
});
