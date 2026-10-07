import UIKit

/// Hands a file made in the page (story video, project file, script) to the iOS
/// share sheet, which offers Save Video, Save to Files, AirDrop, and social apps.
enum FileSharing {
    static let maxBytes = 200 * 1024 * 1024

    enum Failure: LocalizedError {
        case invalid, tooLarge
        var errorDescription: String? {
            switch self {
            case .invalid: return "That file couldn’t be prepared for sharing."
            case .tooLarge: return "That file is too large to share from the app."
            }
        }
    }

    /// Turns a page-supplied name into a safe file name that keeps its extension.
    static func safeFileName(_ name: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_."))
        let cleaned = String(name.unicodeScalars.map { allowed.contains($0) ? Character($0) : "-" })
            .trimmingCharacters(in: CharacterSet(charactersIn: ".-"))
        let limited = String(cleaned.suffix(80))
        return limited.isEmpty ? "StoryVerse-file" : limited
    }

    @MainActor
    static func share(base64: String, fileName: String) async throws -> Bool {
        guard base64.count <= maxBytes / 3 * 4 + 4 else { throw Failure.tooLarge }
        guard let data = Data(base64Encoded: base64), !data.isEmpty else { throw Failure.invalid }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("shared", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent(safeFileName(fileName))
        try data.write(to: url, options: .atomic)

        guard let presenter = UIApplication.shared.topViewController else { throw Failure.invalid }
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        if let popover = sheet.popoverPresentationController {
            popover.sourceView = presenter.view
            popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.maxY - 80, width: 1, height: 1)
            popover.permittedArrowDirections = []
        }
        return await withCheckedContinuation { continuation in
            sheet.completionWithItemsHandler = { _, completed, _, _ in
                try? FileManager.default.removeItem(at: url)
                continuation.resume(returning: completed)
            }
            presenter.present(sheet, animated: true)
        }
    }
}

enum Haptics {
    @MainActor
    static func play(_ style: String) {
        switch style {
        case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
        case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
        case "error": UINotificationFeedbackGenerator().notificationOccurred(.error)
        default: UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }
}
