// What Quill needs to know about a PDF when it's imported, read directly from the file.
// Nothing has to be loaded into memory or sent anywhere, so size doesn't matter.
import CoreGraphics
import ImageIO
import Foundation
import PDFKit
import UIKit

enum PdfInfo {
  private static func fail(_ text: String) -> NSError {
    NSError(domain: "Quill", code: 3, userInfo: [NSLocalizedDescriptionKey: text])
  }

  /// The first page as a small picture, for the note's card.
  static func cover(_ path: String, to dst: String, width: Double) -> Bool {
    guard let doc = PDFDocument(url: URL(fileURLWithPath: path)), let page = doc.page(at: 0) else { return false }
    let box = page.bounds(for: .cropBox)
    let turned = abs(page.rotation) % 180 == 90
    let ratio = (turned ? box.width : box.height) / max(1, turned ? box.height : box.width)
    let size = CGSize(width: width, height: width * Double(ratio))
    guard let data = page.thumbnail(of: size, for: .cropBox).jpegData(compressionQuality: 0.8) else { return false }
    return (try? data.write(to: URL(fileURLWithPath: dst), options: .atomic)) != nil
  }

  /// Each page's size as displayed (rotation included) and some text for search.
  static func read(_ path: String, maxText: Int) throws -> [String: Any] {
    let url = URL(fileURLWithPath: path)
    guard let doc = CGPDFDocument(url as CFURL) else { throw fail("That PDF couldn't be opened. It may be damaged.") }
    if doc.isEncrypted && !doc.isUnlocked { _ = doc.unlockWithPassword("") }
    if !doc.isUnlocked { throw fail("This PDF is password-protected. Remove the password and try again.") }
    guard doc.numberOfPages > 0 else { throw fail("That PDF has no pages.") }
    var pages: [[Double]] = []
    pages.reserveCapacity(doc.numberOfPages)
    for i in 1...doc.numberOfPages {
      guard let p = doc.page(at: i) else { pages.append([612, 792]); continue }
      let box = p.getBoxRect(.cropBox)
      let turned = abs(p.rotationAngle) % 180 == 90
      let w = Double(turned ? box.height : box.width), h = Double(turned ? box.width : box.height)
      pages.append([(w * 100).rounded() / 100, (h * 100).rounded() / 100])
    }
    // Text for search, from the first pages that have any. Scans have none, so it stops looking early.
    var text = ""
    if let kit = PDFDocument(url: url) {
      for i in 0..<min(80, kit.pageCount) where text.count < maxText {
        autoreleasepool { text += (kit.page(at: i)?.string ?? "") + " " }
      }
    }
    let spaced = text.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
    return ["pages": pages, "text": String(spaced.prefix(maxText))]
  }
}

/// A picture made smaller as a JPEG, read straight from its file, the right way up.
enum ImageShrink {
  static func run(src: String, dst: String, maxSide: Double, quality: Double, wantBase64: Bool) throws -> [String: Any] {
    let fail = NSError(domain: "Quill", code: 5, userInfo: [NSLocalizedDescriptionKey: "That picture couldn't be opened."])
    guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: src) as CFURL, nil) else { throw fail }
    let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
    let w = props?[kCGImagePropertyPixelWidth] as? Double ?? maxSide, h = props?[kCGImagePropertyPixelHeight] as? Double ?? maxSide
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceShouldCacheImmediately: true,
      kCGImageSourceThumbnailMaxPixelSize: Int(min(max(w, h), maxSide)),
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
          let data = UIImage(cgImage: image).jpegData(compressionQuality: quality) else { throw fail }
    var out: [String: Any] = ["w": image.width, "h": image.height]
    if !dst.isEmpty {
      let url = URL(fileURLWithPath: dst)
      try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      try data.write(to: url, options: .atomic)
    }
    if wantBase64 { out["base64"] = data.base64EncodedString() }
    return out
  }
}
