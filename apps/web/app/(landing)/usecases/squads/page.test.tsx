import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Page, { metadata } from "./page";

function resolveTitle(m: typeof metadata): string {
  const t = m.title;
  if (typeof t === "string") return t;
  if (t && typeof t === "object" && "absolute" in t && typeof t.absolute === "string") {
    return t.absolute;
  }
  if (t && typeof t === "object" && "default" in t && typeof t.default === "string") {
    return t.default;
  }
  return "";
}

// PNG layout: 8-byte signature, then chunks; first chunk header is "IHDR" at offset 12,
// width at 16..19 (uint32 BE), height at 20..23. Spec: https://www.w3.org/TR/png/#11IHDR
function readPngSize(absPath: string): { width: number; height: number } {
  const buf = readFileSync(absPath);
  expect(
    buf
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  ).toBe(true);
  expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function extractJsonLd(container: HTMLElement): unknown[] {
  return Array.from(
    container.querySelectorAll('script[type="application/ld+json"]'),
  ).map((el) => JSON.parse(el.textContent ?? ""));
}

describe("/usecases/squads — metadata", () => {
  it("uses title.absolute (bypasses root template) and resolves to ≤60 chars", () => {
    const t = metadata.title;
    expect(typeof t === "object" && t !== null && "absolute" in t).toBe(true);
    const resolved = resolveTitle(metadata);
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved.length).toBeLessThanOrEqual(60);
  });

  it("description is ≤155 chars", () => {
    expect(metadata.description?.length ?? 0).toBeGreaterThan(0);
    expect(metadata.description?.length ?? 0).toBeLessThanOrEqual(155);
  });

  it("canonical is the absolute path /usecases/squads", () => {
    expect(metadata.alternates?.canonical).toBe("/usecases/squads");
  });
});

describe("/usecases/squads — JSON-LD", () => {
  function renderAndExtract() {
    const { container } = render(<Page />);
    const graphs = extractJsonLd(container);
    const entities = graphs.flatMap((g: any) =>
      g["@graph"] ? g["@graph"] : [g],
    );
    return { container, entities };
  }

  it("contains exactly one Article and one FAQPage; no SoftwareApplication (layout owns that)", () => {
    const { entities } = renderAndExtract();
    expect(entities.filter((e: any) => e["@type"] === "Article")).toHaveLength(
      1,
    );
    expect(entities.filter((e: any) => e["@type"] === "FAQPage")).toHaveLength(
      1,
    );
    expect(
      entities.filter((e: any) => e["@type"] === "SoftwareApplication"),
    ).toHaveLength(0);
  });

  it("Article carries headline, Organization author/publisher, both dates, and canonical mainEntityOfPage", () => {
    const { entities } = renderAndExtract();
    const article = entities.find((e: any) => e["@type"] === "Article") as any;
    expect(article.headline).toBe(
      "Assign issues to AI agent teams: routing with Multica squads",
    );
    expect(article.author?.["@type"]).toBe("Organization");
    expect(article.author?.name).toBe("Multica");
    expect(article.publisher?.["@type"]).toBe("Organization");
    expect(article.publisher?.name).toBe("Multica");
    expect(article.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(article.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(article.mainEntityOfPage).toBe(
      "https://www.multica.ai/usecases/squads",
    );
  });

  it("FAQPage has mainEntity questions with name + acceptedAnswer.text, all visible in body", () => {
    const { container, entities } = renderAndExtract();
    const faq = entities.find((e: any) => e["@type"] === "FAQPage") as any;
    expect(Array.isArray(faq.mainEntity)).toBe(true);
    expect(faq.mainEntity.length).toBeGreaterThanOrEqual(1);

    // Strip <script> contents so body text reflects what the user actually sees.
    const visibleRoot = container.cloneNode(true) as HTMLElement;
    visibleRoot
      .querySelectorAll("script")
      .forEach((s) => s.parentNode?.removeChild(s));
    const bodyText = visibleRoot.textContent ?? "";

    for (const q of faq.mainEntity) {
      expect(q["@type"]).toBe("Question");
      expect(typeof q.name).toBe("string");
      expect(q.name.length).toBeGreaterThan(0);
      expect(q.acceptedAnswer?.["@type"]).toBe("Answer");
      expect(typeof q.acceptedAnswer.text).toBe("string");
      expect(q.acceptedAnswer.text.length).toBeGreaterThan(0);
      expect(bodyText).toContain(q.name);
      expect(bodyText).toContain(q.acceptedAnswer.text);
    }
  });
});

describe("/usecases/squads — image assets", () => {
  const seg = join(process.cwd(), "app", "(landing)", "usecases", "squads");
  const og = join(seg, "opengraph-image.png");
  const tw = join(seg, "twitter-image.png");

  it("both OG and Twitter PNGs exist on disk", () => {
    expect(existsSync(og)).toBe(true);
    expect(existsSync(tw)).toBe(true);
  });

  it("OG PNG is 1200×630", () => {
    expect(readPngSize(og)).toEqual({ width: 1200, height: 630 });
  });

  it("Twitter PNG is 1200×630", () => {
    expect(readPngSize(tw)).toEqual({ width: 1200, height: 630 });
  });
});
