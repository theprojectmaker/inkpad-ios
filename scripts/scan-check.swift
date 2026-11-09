// Runs the real scan cleanup on sample pictures (on a Mac, with Apple's own filters), in a few
// versions side by side: <name>-<version>.jpg, plus a full-size close-up of each (<name>-<version>-zoom.jpg).
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers

@main
struct Check {
  static let versions: [(String, [String: CGFloat])] = [
    ("a-before", ["rules": 0, "neutral": 0, "wb": 0]),
    ("b-new", [:]),
    ("c-paler-lines", ["lineDark": 0.985]),
    ("d-new-thinner", ["cut": 0.05, "blur": 0.4]),
  ]
  static func main() throws {
    let args = CommandLine.arguments
    let (input, output) = (args[1], args[2])
    let ci = CIContext()
    let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
    try FileManager.default.createDirectory(atPath: output, withIntermediateDirectories: true)
    for name in try FileManager.default.contentsOfDirectory(atPath: input).sorted() where name.hasSuffix(".jpg") {
      guard let img = CIImage(contentsOf: URL(fileURLWithPath: "\(input)/\(name)")) else { continue }
      let base = name.replacingOccurrences(of: ".jpg", with: "")
      for (label, knobs) in versions {
        ScanFilter.tune = knobs
        let t = Date()
        let out = ScanFilter.clean(img, mode: "color")
        let q = [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.9]
        try ci.writeJPEGRepresentation(of: out, to: URL(fileURLWithPath: "\(output)/\(base)-\(label).jpg"), colorSpace: srgb, options: q)
        // A close-up at full size: the left part of the page, from a bit below the top.
        let e = out.extent
        for (tag, y) in [("low", 0.22), ("high", 0.55)] {
          let zoom = CGRect(x: e.minX + e.width * 0.06, y: e.minY + e.height * y, width: e.width * 0.5, height: e.height * 0.36)
          try ci.writeJPEGRepresentation(of: out.cropped(to: zoom), to: URL(fileURLWithPath: "\(output)/\(base)-\(label)-\(tag).jpg"), colorSpace: srgb, options: q)
        }
        print("\(base) \(label): \(Int(e.width))x\(Int(e.height)) in \(String(format: "%.1f", Date().timeIntervalSince(t))) s")
      }
    }
  }
}
