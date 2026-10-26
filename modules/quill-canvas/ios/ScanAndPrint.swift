// Paper to iPad: Apple's document camera (finds the page edges, flattens and
// cleans the photo), and HTML -> PDF for the clean typed copy the AI writes.
import CoreImage
import ExpoModulesCore
import UIKit
import VisionKit

final class ScanSession: NSObject, VNDocumentCameraViewControllerDelegate {
  private let promise: Promise
  private let onDone: () -> Void
  private let enhance: Bool
  private static let ci = CIContext()

  init(promise: Promise, enhance: Bool, onDone: @escaping () -> Void) {
    self.promise = promise
    self.enhance = enhance
    self.onDone = onDone
  }

  /// Makes a scan look like a clean original: white paper, dark crisp ink, no shadows.
  /// Only the picture is cleaned up; nothing on the page is changed or retyped.
  static func cleanUp(_ img: UIImage) -> UIImage {
    guard var image = CIImage(image: img) else { return img }
    if let f = CIFilter(name: "CIDocumentEnhancer") {
      f.setValue(image, forKey: kCIInputImageKey)
      f.setValue(1.0, forKey: "inputAmount")
      if let o = f.outputImage { image = o }
    } else if let f = CIFilter(name: "CIColorControls") {
      f.setValue(image, forKey: kCIInputImageKey)
      f.setValue(1.25, forKey: kCIInputContrastKey)
      f.setValue(0.06, forKey: kCIInputBrightnessKey)
      if let o = f.outputImage { image = o }
    }
    if let f = CIFilter(name: "CISharpenLuminance") {
      f.setValue(image, forKey: kCIInputImageKey)
      f.setValue(0.45, forKey: kCIInputSharpnessKey)
      if let o = f.outputImage { image = o }
    }
    guard let cg = ci.createCGImage(image, from: image.extent) else { return img }
    return UIImage(cgImage: cg, scale: 1, orientation: img.imageOrientation)
  }

  func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
    var paths: [String] = []
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("quill-scans", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let stamp = Int(Date().timeIntervalSince1970 * 1000)
    for i in 0..<scan.pageCount {
      var img = ScanSession.downscale(scan.imageOfPage(at: i), maxSide: enhance ? 2400 : 2000)
      if enhance { img = ScanSession.cleanUp(img) }
      let url = dir.appendingPathComponent("scan_\(stamp)_\(i).jpg")
      if let data = img.jpegData(compressionQuality: enhance ? 0.9 : 0.85), (try? data.write(to: url, options: .atomic)) != nil { paths.append(url.path) }
    }
    controller.dismiss(animated: true) { [self] in
      promise.resolve(paths)
      onDone()
    }
  }

  func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
    controller.dismiss(animated: true) { [self] in
      promise.resolve([String]())
      onDone()
    }
  }

  func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
    controller.dismiss(animated: true) { [self] in
      promise.reject("E_SCAN", error.localizedDescription)
      onDone()
    }
  }

  static func downscale(_ img: UIImage, maxSide: CGFloat) -> UIImage {
    let big = max(img.size.width, img.size.height)
    if big <= maxSide { return img }
    let k = maxSide / big
    let size = CGSize(width: img.size.width * k, height: img.size.height * k)
    let fmt = UIGraphicsImageRendererFormat()
    fmt.scale = 1
    return UIGraphicsImageRenderer(size: size, format: fmt).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
  }
}

enum PrintHTML {
  /// Lays the HTML out on Letter pages (0.75 in margins) and writes a PDF. Returns the page count.
  static func pdf(_ html: String, to path: String) throws -> Int {
    let fmt = UIMarkupTextPrintFormatter(markupText: html)
    let renderer = UIPrintPageRenderer()
    renderer.addPrintFormatter(fmt, startingAtPageAt: 0)
    let page = CGRect(x: 0, y: 0, width: 612, height: 792)
    renderer.setValue(NSValue(cgRect: page), forKey: "paperRect")
    renderer.setValue(NSValue(cgRect: page.insetBy(dx: 54, dy: 54)), forKey: "printableRect")
    let data = NSMutableData()
    UIGraphicsBeginPDFContextToData(data, page, nil)
    renderer.prepare(forDrawingPages: NSRange(location: 0, length: renderer.numberOfPages))
    let n = renderer.numberOfPages
    for i in 0..<n {
      UIGraphicsBeginPDFPage()
      renderer.drawPage(at: i, in: UIGraphicsGetPDFContextBounds())
    }
    UIGraphicsEndPDFContext()
    let url = URL(fileURLWithPath: path)
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try data.write(to: url, options: .atomic)
    return n
  }
}
