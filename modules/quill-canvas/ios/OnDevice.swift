// Things Quill does on the iPad itself, with no internet:
// - reading printed and handwritten text from a picture (Apple's Vision),
// - making a photo or scan look clean and sharp (Core Image),
// - Apple's on-device language model for the study tools (iOS 26, Apple Intelligence iPads).
import CoreImage
import Foundation
import UIKit
import Vision
#if canImport(FoundationModels)
import FoundationModels
#endif

enum OnDevice {
  private static let ci = CIContext()

  /// Every line of text in the picture, top to bottom: text plus where it sits
  /// (0...1 of the picture, top-left origin) and how sure Vision is.
  static func readText(_ path: String) throws -> [String: Any] {
    guard let img = UIImage(contentsOfFile: path), let cg = img.cgImage else {
      throw NSError(domain: "Quill", code: 1, userInfo: [NSLocalizedDescriptionKey: "Couldn't open that picture."])
    }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = true
    if #available(iOS 16.0, *) { req.automaticallyDetectsLanguage = true }
    let handler = VNImageRequestHandler(cgImage: cg, orientation: orientation(img.imageOrientation), options: [:])
    try handler.perform([req])
    let lines: [[String: Any]] = (req.results ?? []).compactMap { o in
      guard let c = o.topCandidates(1).first, !c.string.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
      let b = o.boundingBox
      return ["text": c.string, "x": b.minX, "y": 1 - b.maxY, "w": b.width, "h": b.height, "conf": c.confidence]
    }
    let upright = img.imageOrientation == .left || img.imageOrientation == .right
    let w = Double(upright ? cg.height : cg.width), h = Double(upright ? cg.width : cg.height)
    return ["lines": lines, "width": w, "height": h]
  }

  /// A scan or photo of a page, cleaned up (see ScanFilter). Nothing on the page is changed or retyped.
  static func fix(_ input: UIImage, mode: String) -> UIImage {
    let img = upright(input)
    guard let image = CIImage(image: img) else { return input }
    let out = ScanFilter.clean(image, mode: mode)
    guard let cg = ci.createCGImage(out, from: out.extent) else { return input }
    return UIImage(cgImage: cg, scale: 1, orientation: .up)
  }

  /// The picture drawn the right way up (camera photos carry a rotation flag).
  private static func upright(_ img: UIImage) -> UIImage {
    if img.imageOrientation == .up { return img }
    let fmt = UIGraphicsImageRendererFormat()
    fmt.scale = 1
    return UIGraphicsImageRenderer(size: CGSize(width: img.size.width * img.scale, height: img.size.height * img.scale), format: fmt).image { _ in
      img.draw(in: CGRect(origin: .zero, size: CGSize(width: img.size.width * img.scale, height: img.size.height * img.scale)))
    }
  }

  /// A cleaned-up copy of a page picture, saved as JPEG at `dst`.
  static func enhance(_ src: String, to dst: String, mode: String) throws -> Bool {
    guard let img = UIImage(contentsOfFile: src) else {
      throw NSError(domain: "Quill", code: 1, userInfo: [NSLocalizedDescriptionKey: "Couldn't open that picture."])
    }
    guard let data = autoreleasepool(invoking: { fix(img, mode: mode).jpegData(compressionQuality: 0.93) }) else { return false }
    let url = URL(fileURLWithPath: dst)
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try data.write(to: url, options: .atomic)
    return true
  }

  /// "ready", "off" (Apple Intelligence is turned off), "downloading" or "unsupported".
  static func aiStatus() -> String {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      switch SystemLanguageModel.default.availability {
      case .available: return "ready"
      case .unavailable(let why):
        switch why {
        case .deviceNotEligible: return "unsupported"
        case .appleIntelligenceNotEnabled: return "off"
        case .modelNotReady: return "downloading"
        @unknown default: return "unsupported"
        }
      @unknown default: return "unsupported"
      }
    }
    #endif
    return "unsupported"
  }

  /// One answer from Apple's on-device model.
  static func ask(instructions: String, prompt: String) async throws -> String {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      let session = LanguageModelSession(instructions: instructions)
      let r = try await session.respond(to: prompt)
      return r.content
    }
    #endif
    throw NSError(domain: "Quill", code: 2, userInfo: [NSLocalizedDescriptionKey: "This iPad can't run the offline AI."])
  }

  private static func orientation(_ o: UIImage.Orientation) -> CGImagePropertyOrientation {
    switch o {
    case .up: return .up
    case .down: return .down
    case .left: return .left
    case .right: return .right
    case .upMirrored: return .upMirrored
    case .downMirrored: return .downMirrored
    case .leftMirrored: return .leftMirrored
    case .rightMirrored: return .rightMirrored
    @unknown default: return .up
    }
  }
}
