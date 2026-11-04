// What Quill needs to know about a PDF when it's imported, read directly from the file.
// Nothing has to be loaded into memory or sent anywhere, so size doesn't matter.
import CoreGraphics
import Foundation
import PDFKit

enum PdfInfo {
  private static func fail(_ text: String) -> NSError {
    NSError(domain: "Quill", code: 3, userInfo: [NSLocalizedDescriptionKey: text])
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
