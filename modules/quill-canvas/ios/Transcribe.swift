// A recording turned into timed lines of text, on the iPad where it can be.
import Foundation
import Speech

enum Transcriber {
  private static var task: SFSpeechRecognitionTask?
  private static var lines: [[String: Any]] = []
  private static var finish: DispatchWorkItem?

  private static func fail(_ text: String, _ done: @escaping (Result<[[String: Any]], Error>) -> Void) {
    done(.failure(NSError(domain: "Quill", code: 2, userInfo: [NSLocalizedDescriptionKey: text])))
  }

  /// Words grouped into lines, each with the second it starts at.
  static func group(_ segments: [SFTranscriptionSegment], into out: inout [[String: Any]]) {
    var words: [String] = []
    var start = 0.0, last = 0.0
    func flush() {
      if !words.isEmpty { out.append(["t": start, "text": words.joined(separator: " ")]) }
      words = []
    }
    for s in segments {
      if words.isEmpty { start = s.timestamp }
      else if words.count >= 14 || s.timestamp - last > 1.2 { flush(); start = s.timestamp }
      words.append(s.substring)
      last = s.timestamp + s.duration
    }
    flush()
  }

  static func run(_ path: String, done: @escaping (Result<[[String: Any]], Error>) -> Void) {
    SFSpeechRecognizer.requestAuthorization { status in
      DispatchQueue.main.async {
        guard status == .authorized else { fail("Allow Speech Recognition for Quill in Settings to make a transcript.", done); return }
        guard let r = SFSpeechRecognizer(), r.isAvailable else { fail("Speech recognition isn't available right now.", done); return }
        let req = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: path))
        req.shouldReportPartialResults = false
        if r.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        req.addsPunctuation = true
        lines = []
        task?.cancel()
        // A long recording can come back in several parts, so finish once they stop arriving.
        task = r.recognitionTask(with: req) { result, error in
          if let result, result.isFinal {
            group(result.bestTranscription.segments, into: &lines)
            finish?.cancel()
            let w = DispatchWorkItem {
              task = nil
              done(.success(lines))
            }
            finish = w
            DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: w)
          } else if let error {
            finish?.cancel()
            task = nil
            if lines.isEmpty { fail("Couldn't make a transcript: \(error.localizedDescription)", done) } else { done(.success(lines)) }
          }
        }
      }
    }
  }
}
