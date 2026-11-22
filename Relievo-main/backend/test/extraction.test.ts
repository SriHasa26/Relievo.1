import { describe, expect, it } from "vitest";
import { keywordExtract, validateExtraction } from "../src/services/extraction";

describe("validateExtraction", () => {
  const good = {
    category: "water", urgency: "high", people_affected: 6, needs: ["water"],
    vulnerable_persons: ["elderly"], missing_info: [], summary: "ok",
  };

  it("accepts a valid object and always forces human verification", () => {
    const out = validateExtraction({ ...good, requires_human_verification: false });
    expect(out.requires_human_verification).toBe(true);
  });

  it("rejects an unknown category", () => {
    expect(() => validateExtraction({ ...good, category: "alien_invasion" })).toThrow();
  });

  it("rejects a negative or non-integer people count", () => {
    expect(() => validateExtraction({ ...good, people_affected: -2 })).toThrow();
    expect(() => validateExtraction({ ...good, people_affected: 2.5 })).toThrow();
  });

  it("rejects missing required fields (malformed AI JSON)", () => {
    expect(() => validateExtraction({ category: "water" })).toThrow();
    expect(() => validateExtraction("not json at all")).toThrow();
  });
});

describe("keywordExtract (fallback / mock AI)", () => {
  it("handles the blueprint flood example", () => {
    const { extraction } = keywordExtract(
      "Water is entering our ground floor. There are six people in the house, including an elderly person. We need help and drinking water.",
    );
    expect(extraction.category).toBe("water");
    expect(extraction.people_affected).toBe(6);
    expect(extraction.vulnerable_persons).toContain("elderly");
    expect(extraction.needs).toEqual(expect.arrayContaining(["water", "rescue_assessment"]));
    expect(extraction.urgency).toBe("high");
    expect(extraction.requires_human_verification).toBe(true);
  });

  it("flags a trapped person as critical rescue", () => {
    const { extraction } = keywordExtract("An old woman is trapped on the roof, water level rising");
    expect(extraction.category).toBe("rescue");
    expect(extraction.urgency).toBe("critical");
  });

  it("asks for missing information on a vague report", () => {
    const { extraction } = keywordExtract("help");
    expect(extraction.category).toBe("other");
    expect(extraction.missing_info).toEqual(
      expect.arrayContaining(["number of people affected", "type of help needed"]),
    );
  });
});
