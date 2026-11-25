import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

describe("phone layout", () => {
  it("stacks the page title above actions and does not truncate the subtitle", () => {
    const header = read("components/finance/page-header.tsx");
    const shell = read("components/layout/shell.tsx");
    expect(shell).toContain('order-last flex w-full min-w-0 flex-col');
    expect(shell).toMatch(/safe-area-inset-top/);
    expect(shell).toMatch(/safe-area-inset-bottom/);
    expect(header).toContain("header-actions");
    expect(header).toContain("text-pretty");
    expect(header).not.toMatch(/truncate/);
  });

  it("turns the mobile command palette into a visual-viewport sheet with a close button", () => {
    const pal = read("components/layout/command-palette.tsx");
    expect(pal).toContain("useVisualViewportBox");
    expect(pal).toContain("100dvh");
    expect(pal).toContain('aria-label="Close"');
    expect(pal).toContain("Search or a command");
    // ESC chip stays on desktop only
    expect(pal).toMatch(/isDesktop[\s\S]*ESC/);
    expect(read("lib/visual-viewport.ts")).toContain("visualViewport");
  });

  it("keeps action labels on one line and 44px tap targets on phones", () => {
    const css = read("styles/shell-ui.css");
    const button = read("components/ui/index.tsx");
    expect(css).toContain(".header-actions");
    expect(css).toMatch(/\.header-actions > \*[\s\S]*white-space:\s*nowrap/);
    expect(css).toMatch(/min-height:\s*44px/);
    expect(button).toContain("whitespace-nowrap");
    expect(button).toMatch(/SectionTitle[\s\S]*flex-col/);
  });
});
