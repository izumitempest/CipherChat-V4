import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { InkMark } from "@/components/cc/mark";

describe("InkMark component", () => {
  it("renders intact variant as SVG", () => {
    const html = renderToString(<InkMark variant="intact" size={48} />);
    expect(html).toContain("<svg");
    expect(html).toContain("ink-fleck");
  });

  it("renders fleck variant", () => {
    const html = renderToString(<InkMark variant="fleck" size={11} />);
    expect(html).toContain("svg");
  });

  it("renders ghost variant", () => {
    const html = renderToString(<InkMark variant="ghost" size={150} draw />);
    expect(html).toContain("svg");
  });

  it("applies custom class", () => {
    const html = renderToString(<InkMark className="custom-class" />);
    expect(html).toContain("custom-class");
  });

  it("renders with breathe variant", () => {
    const html = renderToString(<InkMark variant="intact" breathe />);
    expect(html).toContain("svg");
  });
});
