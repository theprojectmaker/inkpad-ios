// Records a class to a file and turns it into text as it's said, on the iPad where it can be,
// so it works with no internet. A speech request is swapped for a fresh one regularly, because
// a single one stops after a while; the old one finishes on its own, so no words are lost.
import AVFoundation
import Foundation
import Speech
import UIKit

final class LiveRecorder {
  static let shared = LiveRecorder()

  private let lock = NSLock()
  private var engine: AVAudioEngine?
  private var file: AVAudioFile?
  private var format: AVAudioFormat?
  private var frames: Int64 = 0
  private var rate = 44100.0
  private var level: Float = 0
  private var paused = false
  private var running = false
  private var note = ""

  private var recognizer: SFSpeechRecognizer?
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var tasks: [Int: SFSpeechRecognitionTask] = [:]
  private var partials: [Int: String] = [:]
  private var lastSegments: [Int: (base: Double, segments: [SFTranscriptionSegment])] = [:]
  private var generation = 0
  private var failures = 0
  private var speech = "off"
  private var lines: [[String: Any]] = []
  private var rotation: Timer?
  private var feeder: Timer?
  private var observers: [NSObjectProtocol] = []

  private func fail(_ text: String) -> NSError {
    NSError(domain: "Quill", code: 4, userInfo: [NSLocalizedDescriptionKey: text])
  }

  // MARK: - Start and stop

  func start(path: String, done: @escaping (Error?) -> Void) {
    SFSpeechRecognizer.requestAuthorization { status in
      DispatchQueue.main.async {
        do {
          try self.begin(path: path, speechAllowed: status == .authorized)
          done(nil)
        } catch { self.cleanUp(); done(error) }
      }
    }
  }

  private func begin(path: String, speechAllowed: Bool) throws {
    if running { cleanUp() }
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth, .mixWithOthers])
    try session.setActive(true)

    lock.lock()
    frames = 0; level = 0; paused = false; note = ""
    lines = []; partials = [:]; lastSegments = [:]; failures = 0
    lock.unlock()

    let url = URL(fileURLWithPath: path)
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? FileManager.default.removeItem(at: url)

    // Automated tests only: a spoken file stands in for the microphone.
    if let test = testFile() {
      try prepareFile(url, test.processingFormat)
      running = true
      startSpeech(allowed: speechAllowed)
      feed(from: test)
    } else {
      let e = AVAudioEngine()
      let input = e.inputNode
      let f = input.outputFormat(forBus: 0)
      guard f.sampleRate > 0, f.channelCount > 0 else { throw fail("No microphone is available.") }
      try prepareFile(url, f)
      input.installTap(onBus: 0, bufferSize: 4096, format: f) { [weak self] buffer, _ in self?.take(buffer) }
      engine = e
      e.prepare()
      try e.start()
      running = true
      startSpeech(allowed: speechAllowed)
      watchInterruptions(e)
    }
    UIApplication.shared.isIdleTimerDisabled = true
    rotation = Timer.scheduledTimer(withTimeInterval: 50, repeats: true) { [weak self] _ in self?.rotate() }
  }

  private func prepareFile(_ url: URL, _ f: AVAudioFormat) throws {
    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: f.sampleRate,
      AVNumberOfChannelsKey: f.channelCount,
      AVEncoderBitRateKey: 96_000,
    ]
    file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: f.commonFormat, interleaved: f.isInterleaved)
    format = f
    rate = f.sampleRate
  }

  func stop(done: @escaping ([String: Any]) -> Void) {
    guard running else { done(["dur": 0, "lines": []]); return }
    let ms = elapsedMs()
    running = false
    rotation?.invalidate(); rotation = nil
    feeder?.invalidate(); feeder = nil
    engine?.inputNode.removeTap(onBus: 0)
    engine?.stop()
    engine = nil
    lock.lock()
    file = nil              // closing it finishes the file
    let last = request
    request = nil
    lock.unlock()
    last?.endAudio()
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    observers = []
    UIApplication.shared.isIdleTimerDisabled = false
    // The last words take a moment to come back.
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
      self.lock.lock()
      for gen in self.lastSegments.keys.sorted() { self.commit(gen) }
      let out = self.sortedLines()
      self.tasks.values.forEach { $0.cancel() }
      self.tasks = [:]
      self.partials = [:]
      self.lock.unlock()
      try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
      done(["dur": ms, "lines": out])
    }
  }

  private func cleanUp() {
    running = false
    rotation?.invalidate(); rotation = nil
    feeder?.invalidate(); feeder = nil
    engine?.inputNode.removeTap(onBus: 0)
    engine?.stop()
    engine = nil
    lock.lock()
    file = nil
    request = nil
    tasks.values.forEach { $0.cancel() }
    tasks = [:]
    lock.unlock()
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    observers = []
    UIApplication.shared.isIdleTimerDisabled = false
  }

  func setPaused(_ on: Bool) {
    lock.lock(); paused = on; if on { level = 0 }; lock.unlock()
  }

  // MARK: - What's happening right now

  private func elapsedMs() -> Double {
    lock.lock(); defer { lock.unlock() }
    return Double(frames) / rate * 1000
  }

  private func sortedLines() -> [[String: Any]] {
    lines.sorted { ($0["t"] as? Double ?? 0) < ($1["t"] as? Double ?? 0) }
  }

  /// `since`: how many lines the caller already has.
  func poll(since: Int) -> [String: Any] {
    lock.lock(); defer { lock.unlock() }
    let all = sortedLines()
    return [
      "elapsed": Double(frames) / rate * 1000,
      "level": Double(level),
      "paused": paused,
      "speech": speech,
      "note": note,
      "total": all.count,
      "lines": since < all.count ? Array(all[max(0, since)...]) : [],
      "partial": partials.keys.sorted().compactMap { partials[$0] }.joined(separator: " "),
    ]
  }

  // MARK: - Sound coming in

  private func take(_ buffer: AVAudioPCMBuffer) {
    lock.lock(); defer { lock.unlock() }
    guard !paused, let file else { return }
    do { try file.write(from: buffer) } catch { note = "Couldn't save some of the sound."; return }
    frames += Int64(buffer.frameLength)
    request?.append(buffer)
    if let d = buffer.floatChannelData?[0], buffer.frameLength > 0 {
      var sum: Float = 0
      for i in 0..<Int(buffer.frameLength) { sum += d[i] * d[i] }
      let rms = (sum / Float(buffer.frameLength)).squareRoot()
      // Quiet speech across a room should still move the meter.
      level = max(rms.isFinite ? min(1, rms * 12) : 0, level * 0.7)
    }
  }

  private func testFile() -> AVAudioFile? {
    guard UserDefaults.standard.double(forKey: "QuillTestAudio") > 0,
          let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return nil }
    return try? AVAudioFile(forReading: docs.appendingPathComponent("quill-test-lecture.caf"))
  }

  private func feed(from source: AVAudioFile) {
    let f = source.processingFormat
    let chunk = AVAudioFrameCount(f.sampleRate / 10)
    feeder = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
      guard let self, let b = AVAudioPCMBuffer(pcmFormat: f, frameCapacity: chunk) else { return }
      if (try? source.read(into: b, frameCount: chunk)) == nil || b.frameLength == 0 { self.feeder?.invalidate(); return }
      self.take(b)
    }
  }

  /// A call or the mic changing mustn't end the recording.
  private func watchInterruptions(_ e: AVAudioEngine) {
    let c = NotificationCenter.default
    observers.append(c.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] n in
      guard let self, let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            AVAudioSession.InterruptionType(rawValue: raw) == .ended, self.running else { return }
      try? AVAudioSession.sharedInstance().setActive(true)
      try? self.engine?.start()
    })
    observers.append(c.addObserver(forName: .AVAudioEngineConfigurationChange, object: e, queue: .main) { [weak self] _ in
      guard let self, self.running, let e = self.engine else { return }
      let input = e.inputNode
      let f = input.outputFormat(forBus: 0)
      input.removeTap(onBus: 0)
      guard f.sampleRate == self.format?.sampleRate, f.channelCount == self.format?.channelCount else {
        // The new mic can't go in the same file. Whatever's recorded so far is safe.
        self.lock.lock()
        self.paused = true
        self.note = "The microphone changed. Stop and start again to keep recording."
        self.lock.unlock()
        return
      }
      input.installTap(onBus: 0, bufferSize: 4096, format: f) { [weak self] buffer, _ in self?.take(buffer) }
      try? e.start()
    })
  }

  // MARK: - Words

  private func startSpeech(allowed: Bool) {
    guard allowed, let r = SFSpeechRecognizer() else {
      lock.lock(); speech = "off"; lock.unlock()
      return
    }
    recognizer = r
    lock.lock(); speech = r.supportsOnDeviceRecognition ? "device" : "online"; lock.unlock()
    newRequest()
  }

  private func rotate() {
    guard running else { return }
    newRequest()
  }

  private func newRequest() {
    guard running, let r = recognizer else { return }
    let req = SFSpeechAudioBufferRecognitionRequest()
    req.shouldReportPartialResults = true
    req.addsPunctuation = true
    req.taskHint = .dictation
    if r.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }

    lock.lock()
    let old = request
    request = req
    generation += 1
    let gen = generation
    let base = Double(frames) / rate
    lock.unlock()
    old?.endAudio()

    let task = r.recognitionTask(with: req) { [weak self] result, error in
      guard let self else { return }
      self.lock.lock()
      if let result {
        self.lastSegments[gen] = (base, result.bestTranscription.segments)
        self.partials[gen] = result.bestTranscription.formattedString
        if !result.bestTranscription.segments.isEmpty { self.failures = 0 }
      }
      let over = (result?.isFinal ?? false) || error != nil
      if over {
        self.commit(gen)
        self.tasks[gen] = nil
      }
      let isCurrent = gen == self.generation
      if error != nil && isCurrent { self.failures += 1 }
      let tooMany = self.failures >= 6
      if tooMany { self.speech = "off" }
      self.lock.unlock()
      // It gave up (a long silence does that): listen again with a new one.
      if over && isCurrent && self.running && !tooMany {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
          guard let self, gen == self.generation else { return }
          self.newRequest()
        }
      }
    }
    lock.lock()
    tasks[gen] = task
    lock.unlock()
  }

  /// Called holding the lock.
  private func commit(_ gen: Int) {
    partials[gen] = nil
    guard let last = lastSegments.removeValue(forKey: gen) else { return }
    var out: [[String: Any]] = []
    Transcriber.group(last.segments, into: &out)
    // Words still being worked out have no times yet: spread those lines over the time they took.
    let timed = (last.segments.last?.timestamp ?? 0) > 0
    let span = max(0, Double(frames) / rate - last.base)
    for (i, var l) in out.enumerated() {
      let at = timed ? (l["t"] as? Double ?? 0) : span * Double(i) / Double(max(1, out.count))
      l["t"] = at + last.base
      lines.append(l)
    }
  }
}
