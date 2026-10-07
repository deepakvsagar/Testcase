import AVFoundation
import Speech

/// Native dictation for “Speak my idea”. The web Speech API isn't available inside
/// an app's web view, so the page asks the app to listen instead.
@MainActor
final class Dictation {
    enum Failure: LocalizedError {
        case notAuthorized, unavailable, busy
        var errorDescription: String? {
            switch self {
            case .notAuthorized: return "Allow Microphone and Speech Recognition for StoryVerse in Settings to dictate."
            case .unavailable: return "Dictation isn’t available right now. Type your idea instead."
            case .busy: return "Already listening."
            }
        }
    }

    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var continuation: CheckedContinuation<String, Error>?
    private var transcript = ""
    private var silenceTimer: Timer?

    var isListening: Bool { continuation != nil }

    /// Listens until stop() is called or the speaker pauses, then returns the text.
    func listen() async throws -> String {
        guard !isListening else { throw Failure.busy }
        guard await Self.requestPermissions() else { throw Failure.notAuthorized }
        guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else { throw Failure.unavailable }

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: .duckOthers)
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        // Keep the user's words on the device whenever the device supports it.
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        self.request = request
        transcript = ""

        let input = engine.inputNode
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
            request.append(buffer)
        }
        engine.prepare()
        try engine.start()

        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                Task { @MainActor in
                    guard let self else { return }
                    if let result {
                        self.transcript = result.bestTranscription.formattedString
                        self.restartSilenceTimer()
                        if result.isFinal { self.finish(nil) }
                    } else if error != nil {
                        self.finish(self.transcript.isEmpty ? Failure.unavailable : nil)
                    }
                }
            }
            restartSilenceTimer(after: 6)
        }
    }

    func stop() {
        guard isListening else { return }
        request?.endAudio()
        finish(nil)
    }

    private func restartSilenceTimer(after seconds: TimeInterval = 2) {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.stop() }
        }
    }

    private func finish(_ error: Error?) {
        silenceTimer?.invalidate()
        silenceTimer = nil
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        task?.cancel()
        task = nil
        request = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        guard let continuation else { return }
        self.continuation = nil
        if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: transcript) }
    }

    private static func requestPermissions() async -> Bool {
        let speech = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0 == .authorized) }
        }
        guard speech else { return false }
        return await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { continuation.resume(returning: $0) }
        }
    }
}
