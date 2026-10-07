import XCTest
@testable import StoryVerse

final class NavigationPolicyTests: XCTestCase {
    private let host = "stories.example.org"

    func testSitePagesLoadInApp() {
        XCTAssertEqual(NavigationPolicy.decide(url: URL(string: "https://stories.example.org/studio.html?path=drama"), siteHost: host), .allow)
        XCTAssertEqual(NavigationPolicy.decide(url: URL(string: "https://STORIES.example.org/"), siteHost: host), .allow)
    }

    func testOtherSitesOpenOutsideTheApp() {
        XCTAssertEqual(NavigationPolicy.decide(url: URL(string: "https://studio.youtube.com/"), siteHost: host), .openExternally)
        XCTAssertEqual(NavigationPolicy.decide(url: URL(string: "https://stories.example.org.evil.com/"), siteHost: host), .openExternally)
        XCTAssertEqual(NavigationPolicy.decide(url: URL(string: "mailto:help@example.org"), siteHost: host), .openExternally)
    }

    func testWebSignInIsReplacedBySignInWithApple() {
        XCTAssertEqual(NavigationPolicy.decide(url: URL(string: "https://stories.example.org/signin-with-chatgpt?return_to=%2F"), siteHost: host), .nativeSignIn)
    }

    func testPageGeneratedContentIsAllowed() {
        XCTAssertEqual(NavigationPolicy.decide(url: URL(string: "blob:https://stories.example.org/1234"), siteHost: host), .allow)
        XCTAssertEqual(NavigationPolicy.decide(url: URL(string: "about:blank"), siteHost: host), .allow)
    }

    func testUnknownSchemesAndSubframeEscapesAreBlocked() {
        XCTAssertEqual(NavigationPolicy.decide(url: URL(string: "javascript:alert(1)"), siteHost: host), .cancel)
        XCTAssertEqual(NavigationPolicy.decide(url: URL(string: "itms-services://?action=download"), siteHost: host), .cancel)
        XCTAssertEqual(NavigationPolicy.decide(url: URL(string: "http://example.com"), siteHost: host, isMainFrame: false), .cancel)
        XCTAssertEqual(NavigationPolicy.decide(url: nil, siteHost: host), .cancel)
    }
}

final class AppConfigTests: XCTestCase {
    func testHostValidation() {
        XCTAssertTrue(AppConfig.isValidHost("stories.example.org"))
        XCTAssertFalse(AppConfig.isValidHost(""))
        XCTAssertFalse(AppConfig.isValidHost("https://stories.example.org"))
        XCTAssertFalse(AppConfig.isValidHost("stories.example.org/path"))
        XCTAssertFalse(AppConfig.isValidHost("$(STORYVERSE_SITE_HOST)"), "an unexpanded build setting is not a host")
    }

    func testBuildSettingReachesInfoPlist() {
        XCTAssertTrue(AppConfig.isValidHost(AppConfig.siteHost), "STORYVERSE_SITE_HOST should expand into Info.plist")
    }
}

final class BridgeTests: XCTestCase {
    func testKnownActionsAreParsed() {
        let message = BridgeMessage(body: ["action": "shareFile", "payload": ["fileName": "Story.mp4", "base64": "AAAA", "size": 4]])
        XCTAssertEqual(message?.action, .shareFile)
        XCTAssertEqual(message?.payload, ["fileName": "Story.mp4", "base64": "AAAA"], "non-string values are dropped")
    }

    func testUnknownOrMalformedMessagesAreRejected() {
        XCTAssertNil(BridgeMessage(body: ["action": "deleteEverything"]))
        XCTAssertNil(BridgeMessage(body: "signIn"))
        XCTAssertNil(BridgeMessage(body: ["payload": [:]]))
    }

    func testSessionTokenIsEmbeddedAsAStringLiteral() {
        let script = BridgeScript.source(sessionToken: "sv1.abc'\"</script>.def")
        XCTAssertTrue(script.contains(#"let session = "sv1.abc'\"<\/script>.def";"#) || script.contains(#"let session = "sv1.abc'\"</script>.def";"#))
        XCTAssertTrue(BridgeScript.source(sessionToken: nil).contains("let session = null;"))
    }
}

final class AccountTests: XCTestCase {
    func testSessionValidity() {
        XCTAssertTrue(AppSession(token: "sv1.a.b", expiresAt: Date().addingTimeInterval(60)).isValid)
        XCTAssertFalse(AppSession(token: "sv1.a.b", expiresAt: Date().addingTimeInterval(-1)).isValid)
        XCTAssertFalse(AppSession(token: "other", expiresAt: Date().addingTimeInterval(60)).isValid)
    }

    func testNonceHashMatchesWhatTheServerChecks() {
        XCTAssertEqual(AppleSignIn.sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        let nonce = AppleSignIn.makeNonce()
        XCTAssertEqual(nonce.count, 32)
        XCTAssertNotEqual(nonce, AppleSignIn.makeNonce())
    }

    func testSharedFileNamesAreSanitised() {
        XCTAssertEqual(FileSharing.safeFileName("StoryVerse-Tomorrow-s-Menu.mp4"), "StoryVerse-Tomorrow-s-Menu.mp4")
        XCTAssertEqual(FileSharing.safeFileName("../../etc/passwd"), "etc-passwd")
        XCTAssertEqual(FileSharing.safeFileName("..."), "StoryVerse-file")
    }
}
