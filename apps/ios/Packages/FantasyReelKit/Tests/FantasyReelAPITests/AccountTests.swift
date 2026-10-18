import CoreGraphics
import FantasyReelCore
import Foundation
import ImageIO
import Testing
import UniformTypeIdentifiers
@testable import FantasyReelAPI

/// Profile photos are re-encoded like the web's (utils/avatarUpload.ts): a
/// square of at most 512 px, JPEG, with no metadata left (F-03, T-15).
struct AvatarImageTests {
    /// An image of `width`×`height` in `type`, carrying GPS and camera metadata.
    private func image(width: Int, height: Int, type: UTType = .png, frames: Int = 1) throws -> Data {
        let context = try #require(CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ))
        context.setFillColor(red: 0.8, green: 0.2, blue: 0.2, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let cgImage = try #require(context.makeImage())
        let output = NSMutableData()
        let destination = try #require(CGImageDestinationCreateWithData(output as CFMutableData, type.identifier as CFString, frames, nil))
        let metadata: [CFString: Any] = [
            kCGImagePropertyGPSDictionary: [kCGImagePropertyGPSLatitude: 37.33, kCGImagePropertyGPSLatitudeRef: "N"],
            kCGImagePropertyTIFFDictionary: [kCGImagePropertyTIFFModel: "Test Camera"],
        ]
        for _ in 0..<frames {
            CGImageDestinationAddImage(destination, cgImage, metadata as CFDictionary)
        }
        #expect(CGImageDestinationFinalize(destination))
        return output as Data
    }

    private func properties(_ data: Data) throws -> [CFString: Any] {
        let source = try #require(CGImageSourceCreateWithData(data as CFData, nil))
        return try #require(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
    }

    @Test func largePhotoBecomesA512SquareJPEG() throws {
        let prepared = try AvatarImage.prepare(image(width: 1600, height: 900))
        #expect(prepared.contentType == "image/jpeg")
        #expect(prepared.side == 512)
        let props = try properties(prepared.data)
        #expect(props[kCGImagePropertyPixelWidth] as? Int == 512)
        #expect(props[kCGImagePropertyPixelHeight] as? Int == 512)
        #expect(prepared.data.count <= AvatarImage.maxStoredBytes)
    }

    @Test func smallPhotoIsCroppedButNotEnlarged() throws {
        let prepared = try AvatarImage.prepare(image(width: 300, height: 200))
        #expect(prepared.side == 200)
    }

    @Test func metadataIsRemoved() throws {
        let prepared = try AvatarImage.prepare(image(width: 800, height: 800))
        let props = try properties(prepared.data)
        #expect(props[kCGImagePropertyGPSDictionary] == nil)
        let tiff = props[kCGImagePropertyTIFFDictionary] as? [CFString: Any]
        #expect(tiff?[kCGImagePropertyTIFFModel] == nil)
    }

    @Test func animatedGIFKeepsItsFirstFrame() throws {
        let prepared = try AvatarImage.prepare(image(width: 120, height: 120, type: .gif, frames: 3))
        #expect(prepared.side == 120)
        let source = try #require(CGImageSourceCreateWithData(prepared.data as CFData, nil))
        #expect(CGImageSourceGetCount(source) == 1)
    }

    @Test func rejectsOversizedAndUnreadableFiles() {
        #expect(throws: AvatarImage.PrepareError.tooLarge) {
            try AvatarImage.prepare(Data(count: AvatarImage.maxInputBytes + 1))
        }
        #expect(throws: AvatarImage.PrepareError.unreadable) {
            try AvatarImage.prepare(Data("not an image".utf8))
        }
    }

    @Test func publicURLGetsACacheBuster() throws {
        let url = try #require(URL(string: "http://127.0.0.1:54321/storage/v1/object/public/avatars/u1/avatar"))
        let date = Date(timeIntervalSince1970: 1_700_000_000.5)
        #expect(SupabaseAvatarStorage.versioned(url, at: date)
            == "http://127.0.0.1:54321/storage/v1/object/public/avatars/u1/avatar?v=1700000000500")
    }
}

struct AccountDeletionTests {
    @Test func reauthAndLiveDraftAreOutcomes() {
        let reauth = APIError.server(.init(status: 403, message: "Sign in again to delete your account", code: "reauth_required"))
        #expect(AccountDeletion.outcome(for: reauth) == .reauthRequired(message: "Sign in again to delete your account"))

        let draft = APIError.server(.init(
            status: 409,
            message: "Finish the draft in Office Movie Club before deleting your account",
            code: "live_draft",
            body: ["error": "Finish the draft in Office Movie Club before deleting your account", "code": "live_draft", "leagues": ["Office Movie Club"]]
        ))
        #expect(AccountDeletion.outcome(for: draft) == .liveDraft(
            leagues: ["Office Movie Club"],
            message: "Finish the draft in Office Movie Club before deleting your account"
        ))
    }

    @Test func otherFailuresStayErrors() {
        #expect(AccountDeletion.outcome(for: .server(.init(status: 400, message: "Type DELETE to confirm"))) == nil)
        #expect(AccountDeletion.outcome(for: .timedOut(requestID: "r")) == nil)
    }
}

struct AccountLinkingTests {
    @Test func signInMethodsKeepTheLastWayIn() {
        let apple = LinkedIdentity(id: "1", provider: "apple", detail: nil)
        let email = LinkedIdentity(id: "2", provider: "email", detail: "a@b.test")
        #expect(!SignInMethods(email: nil, hasPassword: false, identities: [apple]).canDisconnectProvider)
        #expect(SignInMethods(email: "a@b.test", hasPassword: true, identities: [apple, email]).canDisconnectProvider)
        #expect(SignInMethods(email: nil, hasPassword: false, identities: [apple, LinkedIdentity(id: "3", provider: "google", detail: nil)]).canDisconnectProvider)
        #expect(SignInMethods(email: nil, hasPassword: false, identities: [apple]).identity(for: .apple) == apple)
    }

    @Test func linkErrorsUseFriendlyWording() {
        #expect(AuthService.linkError(code: "identity_already_exists", message: "Identity is already linked to another user").userMessage
            == AuthService.identityInUseMessage)
        #expect(AuthService.linkError(code: "single_identity_not_deletable", message: "").userMessage
            == AuthService.onlySignInMethod)
    }

    @Test func linkScopesMatchTheWeb() {
        #expect(AuthService.linkScopes(.google) == "openid email profile")
        #expect(AuthService.linkScopes(.discord) == "identify email")
        #expect(AuthService.linkScopes(.apple) == nil)
    }
}

struct DiscordClientIDTests {
    private let base: [String: Any] = [
        "FRSupabaseURL": "http://127.0.0.1:54321",
        "FRSupabaseAnonKey": "anon",
        "FRSiteURL": "https://fantasyreel.com",
        "FRURLScheme": "fantasyreel",
    ]

    @Test func unsetClientIDIsNil() throws {
        var info = base
        info["FRDiscordClientID"] = "$(FR_DISCORD_CLIENT_ID)"
        #expect(try AppConfiguration.load(from: info).discordClientID == nil)
    }

    @Test func clientIDIsRead() throws {
        var info = base
        info["FRDiscordClientID"] = "1234567890"
        #expect(try AppConfiguration.load(from: info).discordClientID == "1234567890")
    }
}
