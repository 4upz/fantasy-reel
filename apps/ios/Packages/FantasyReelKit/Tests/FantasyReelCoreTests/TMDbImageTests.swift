import Foundation
import Testing
@testable import FantasyReelCore

struct TMDbImageTests {
    func poster(_ value: String?, _ size: TMDbImageSize = .w500) -> String? {
        TMDbImage.posterURL(value, size: size)?.absoluteString
    }

    @Test func barePathsGetTheTMDbOrigin() {
        #expect(poster("/abc123.jpg") == "https://image.tmdb.org/t/p/w500/abc123.jpg")
        #expect(poster("  /abc123.JPEG ", .w154) == "https://image.tmdb.org/t/p/w154/abc123.JPEG")
        #expect(poster("/x.webp", .original) == "https://image.tmdb.org/t/p/original/x.webp")
        #expect(poster("/x.png", .w92) == "https://image.tmdb.org/t/p/w92/x.png")
    }

    @Test func tmdbURLsAreResized() {
        #expect(poster("https://image.tmdb.org/t/p/w780/abc.jpg", .w185) == "https://image.tmdb.org/t/p/w185/abc.jpg")
        #expect(poster("https://image.tmdb.org/t/p/original/abc.png") == "https://image.tmdb.org/t/p/w500/abc.png")
        #expect(poster("http://image.tmdb.org/t/p/w92/abc.jpg") == "https://image.tmdb.org/t/p/w500/abc.jpg")
        #expect(poster("https://image.tmdb.org/t/p/w500/abc.jpg?x=1", .w342) == "https://image.tmdb.org/t/p/w342/abc.jpg")
    }

    @Test func malformedTMDbURLsAreDropped() {
        #expect(poster("https://image.tmdb.org/other/abc.jpg") == nil)
        #expect(poster("https://image.tmdb.org/t/p/big/abc.jpg") == nil)
        #expect(poster("https://image.tmdb.org/t/p/w500/dir/abc.jpg") == nil)
        #expect(poster("https://image.tmdb.org/t/p/w500/abc.gif") == nil)
    }

    @Test func otherHostsPassThrough() {
        #expect(poster("https://cdn.example.com/poster.jpg") == "https://cdn.example.com/poster.jpg")
    }

    @Test func emptyRelativeAndUnsupportedReturnNil() {
        #expect(poster(nil) == nil)
        #expect(poster("") == nil)
        #expect(poster("   ") == nil)
        // A web-relative asset has no origin on iOS.
        #expect(poster("/brand/placeholder/poster.png") == nil)
        #expect(poster("//cdn.example.com/x.jpg") == nil)
        #expect(poster("/.jpg") == nil)
        #expect(poster("ftp://image.tmdb.org/t/p/w500/abc.jpg") == nil)
        #expect(poster("data:image/png;base64,AAAA") == nil)
        #expect(poster("not a url") == nil)
    }
}
