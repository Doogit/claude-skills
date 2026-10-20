import { writeRow } from "./store";

export function orphan(): void {
  stepOne();
}

export function stepOne(): void {
  writeRow("a");
}

export function used(): void {
  writeRow("b");
}

used();
