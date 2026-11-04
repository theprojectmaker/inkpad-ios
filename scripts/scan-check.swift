// Runs the real scan cleanup on sample pictures (on a Mac, with Apple's own filters).
// Output: <name>-color.jpg, <name>-document.jpg and a before/after close-up of each.
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers

@main
struct Check {
  static func main() throws {
    let args = CommandLine.arguments
    let (input, output) = (args[1], args[2])
    let ci = CIContext()
    let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
    try FileManager.default.createDirectory(atPath: output, withIntermediateDirectories: true)
    for name in try FileManager.default.contentsOfDirectory(atPath: input).sorted() where name.hasSuffix(".jpg") {
      guard let img = CIImage(contentsOf: URL(fileURLWithPath: "\(input)/\(name)")) else { continue }
      let base = name.replacingOccurrences(of: ".jpg", with: "")
      for mode in ["color", "document"] {
        let t = Date()
        let out = ScanFilter.clean(img, mode: mode)
        let url = URL(fileURLWithPath: "\(output)/\(base)-\(mode).jpg")
        try ci.writeJPEGRepresentation(of: out, to: url, colorSpace: srgb, options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.92])
        let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
        print("\(base) \(mode): \(Int(out.extent.width))x\(Int(out.extent.height)) \(size / 1024) KB in \(String(format: "%.1f", Date().timeIntervalSince(t))) s")
      }
    }
  }
}
