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

  /// Makes a phone photo or scan of a page look like a clean file, on the iPad:
  /// small photos are enlarged, the lighting is flattened (shadows and grey paper
  /// become even white), and the writing becomes dark and sharp.
  /// mode "color" keeps colours (pens, highlighter); "document" is crisp black and white.
  static func fix(_ input: UIImage, mode: String) -> UIImage {
    let img = upright(input)
    guard var image = CIImage(image: img) else { return input }
    let full = image.extent

    // 1. Too small to read well: enlarge with a high-quality filter.
    let side = max(full.width, full.height)
    if side < 2200, let f = CIFilter(name: "CILanczosScaleTransform") {
      f.setValue(image, forKey: kCIInputImageKey)
      f.setValue(2200 / side, forKey: kCIInputScaleKey)
      f.setValue(1.0, forKey: kCIInputAspectRatioKey)
      if let o = f.outputImage { image = o }
    }
    let ext = image.extent

    // 2. Smooth out the camera's grain first, so evening out the light can't blow it up.
    image = image.applyingFilter("CINoiseReduction", parameters: ["inputNoiseLevel": 0.05, "inputSharpness": 0.4])
      .applyingFilter("CIMedianFilter").cropped(to: ext)

    // 3. The paper's lighting: shrink (the writing almost vanishes), keep the brightest
    //    nearby value (the paper), soften a little; then divide the page by it so the
    //    paper turns even white. Tight on purpose: a wide blur lets the bright middle
    //    leak into dark corners and turns them black.
    let k: CGFloat = 0.125
    let small = image.transformed(by: CGAffineTransform(scaleX: k, y: k))
    let paper = small.clampedToExtent()
      .applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 0.0])
      .applyingFilter("CIMorphologyMaximum", parameters: ["inputRadius": 1])
      .applyingFilter("CIGaussianBlur", parameters: ["inputRadius": 1.5])
      .applyingFilter("CIColorClamp", parameters: [
        "inputMinComponents": CIVector(x: 0.05, y: 0.05, z: 0.05, w: 0), "inputMaxComponents": CIVector(x: 1, y: 1, z: 1, w: 1),
      ])
      .cropped(to: small.extent)
      .clampedToExtent()
      .transformed(by: CGAffineTransform(scaleX: 1 / k, y: 1 / k))
      .cropped(to: ext)
    image = paper.applyingFilter("CIDivideBlendMode", parameters: [kCIInputBackgroundImageKey: image])
      .applyingFilter("CIMedianFilter").cropped(to: ext)

    // 4. Clean, dark, sharp writing; nearly-white paper becomes pure white.
    if mode == "document" {
      // Grey from the darkest colour channel, so blue or red pen turns as dark as pencil
      // (plain brightness would make blue ink faint and broken).
      image = image.applyingFilter("CIMinimumComponent")
      image = image.applyingFilter("CIToneCurve", parameters: [
        "inputPoint0": CIVector(x: 0, y: 0), "inputPoint1": CIVector(x: 0.4, y: 0.1),
        "inputPoint2": CIVector(x: 0.62, y: 0.6), "inputPoint3": CIVector(x: 0.8, y: 1), "inputPoint4": CIVector(x: 1, y: 1),
      ])
    } else {
      // Colour grain gets boosted along with the light: keep the sharp brightness, but
      // take the colour from a smoothed copy (pen and highlighter colours survive).
      let soft = image.clampedToExtent().applyingFilter("CIGaussianBlur", parameters: ["inputRadius": 6]).cropped(to: ext)
        .applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 0.85])
      image = soft.applyingFilter("CIColorBlendMode", parameters: [kCIInputBackgroundImageKey: image]).cropped(to: ext)
      image = image.applyingFilter("CIToneCurve", parameters: [
        "inputPoint0": CIVector(x: 0, y: 0), "inputPoint1": CIVector(x: 0.45, y: 0.3),
        "inputPoint2": CIVector(x: 0.65, y: 0.62), "inputPoint3": CIVector(x: 0.82, y: 1), "inputPoint4": CIVector(x: 1, y: 1),
      ])
    }
    // A slightly blurry scan: a wide unsharp mask rebuilds soft letter edges, then a
    // fine sharpen crisps the detail (wide first, so it doesn't amplify grain).
    image = image.clampedToExtent()
      .applyingFilter("CIUnsharpMask", parameters: [kCIInputRadiusKey: 3.0 * max(1, ext.width / 2200), kCIInputIntensityKey: 0.7])
      .cropped(to: ext)
    image = image.applyingFilter("CISharpenLuminance", parameters: [kCIInputSharpnessKey: 0.45]).cropped(to: ext)
    guard let cg = ci.createCGImage(image, from: ext) else { return input }
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
    guard let data = fix(img, mode: mode).jpegData(compressionQuality: 0.92) else { return false }
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
