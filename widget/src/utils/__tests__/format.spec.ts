import { money, rate, requireVersion, sameVersion, totals, utc } from "../format";
import { groups, version } from "../../api/__tests__/fixtures";
describe("exact presentation", () => {
    test.each([
        ["43482436.24", "$43,482,436.24"],
        ["9007199254740993.01", "$9,007,199,254,740,993.01"],
        ["0.00", "$0.00"],
        ["-12.50", "-$12.50"],
        [null, "\u2014"],
        ["", "\u2014"]
    ])("money %s", (input, expected) => expect(money(input)).toBe(expected));
    test.each([
        ["0.08250000", "8.25%"],
        ["0.00005000", "0.01%"],
        ["0.00000000", "0.00%"],
        ["-0.01250000", "-1.25%"],
        [null, "\u2014"],
        ["", "\u2014"]
    ])("rate %s", (input, expected) => expect(rate(input)).toBe(expected));
    test("sums complete root amounts exactly without averaging rates", () =>
        expect(totals(groups.groups)).toEqual({ count: 3, balance: "9007199254740994.00" }));
    test("empty roots and missing timestamps", () => {
        expect(totals([])).toEqual({ count: 0, balance: "0.00" });
        expect(utc(null)).toBe("Not available");
        expect(utc("invalid")).toBe("Not available");
        expect(utc(version.asOfUtc)).toContain("UTC");
    });
    test.each([{ snapshotVersion: 2 }, { riskRunId: "new-publication" }, { asOfUtc: "2026-11-01T00:00:00Z" }])(
        "keeps all version fields distinct %j",
        change => {
            expect(sameVersion(version, { ...version, ...change })).toBe(false);
            expect(() => requireVersion(version, { ...version, ...change })).toThrow("SNAPSHOT_CHANGED");
        }
    );
});
