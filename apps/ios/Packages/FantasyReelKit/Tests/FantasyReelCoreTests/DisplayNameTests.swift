import Testing
@testable import FantasyReelCore

struct DisplayNameTests {
    @Test func trimsAndChecksLength() {
        #expect(DisplayName.problem("  Alice  ") == nil)
        #expect(DisplayName.trimmed("  Alice  ") == "Alice")
        #expect(DisplayName.problem("   ") == DisplayName.required)
        #expect(DisplayName.problem(String(repeating: "a", count: 100)) == nil)
        #expect(DisplayName.problem(String(repeating: "a", count: 101)) == DisplayName.tooLong)
    }
}
