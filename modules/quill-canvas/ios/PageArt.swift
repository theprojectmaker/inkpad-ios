// Page backgrounds: paper colour + ruling marks, a PDF page, or a photo.
// The same drawing code is used on screen (tiled, so it stays sharp at any
// zoom) and when writing the exported PDF.
import ExpoModulesCore
import UIKit

struct MarkSpec: Record {
  @Field var x: Double = 0
  @Field var y: Double = 0
  @Field var w: Double = 0
  @Field var h: Double = 0
  @Field var r: Double = 0          // > 0: a dot of this radius centred on (x, y)
  @Field var color: String = "#C7D3E6"
}

struct PageSpec: Record {
  @Field var id: String = ""
  @Field var w: Double = 612
  @Field var h: Double = 792
  @Field var bg: String = "#FFFFFF"
  @Field var kind: String = "paper"  // paper | pdf | image
  @Field var file: String = ""       // absolute path of the PDF or image
  @Field var index: Int = 0          // PDF page index (0-based)
  @Field var marks: [MarkSpec] = []
}

extension UIColor {
  convenience init(hex: String) {
    var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.hasPrefix("#") { s.removeFirst() }
    var v: UInt64 = 0
    Scanner(string: s).scanHexInt64(&v)
    if s.count == 8 {
      self.init(red: CGFloat((v >> 24) & 255) / 255, green: CGFloat((v >> 16) & 255) / 255, blue: CGFloat((v >> 8) & 255) / 255, alpha: CGFloat(v & 255) / 255)
    } else {
      self.init(red: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
    }
  }
}

/// Open PDFs and images, shared between the screen and the exporter.
final class ArtCache {
  static let shared = ArtCache()
  private let lock = NSLock()
  // NSCache drops the least used entries under memory pressure (no thrashing, no unbounded growth).
  private let pdfs = NSCache<NSString, CGPDFDocument>()
  private let images: NSCache<NSString, UIImage> = { let c = NSCache<NSString, UIImage>(); c.totalCostLimit = 220 * 1024 * 1024; return c }()

  func pdf(_ path: String) -> CGPDFDocument? {
    lock.lock(); defer { lock.unlock() }
    if let d = pdfs.object(forKey: path as NSString) { return d }
    guard let d = CGPDFDocument(URL(fileURLWithPath: path) as CFURL) else { return nil }
    pdfs.setObject(d, forKey: path as NSString)
    return d
  }

  func image(_ path: String) -> UIImage? {
    lock.lock(); defer { lock.unlock() }
    if let i = images.object(forKey: path as NSString) { return i }
    guard let i = UIImage(contentsOfFile: path) else { return nil }
    let px = Int(i.size.width * i.scale * i.size.height * i.scale * 4)
    images.setObject(i, forKey: path as NSString, cost: px)
    return i
  }
}

enum PageArt {
  /// Draws the page background into `ctx`, page origin at (0, 0), UIKit coordinates (y down).
  static func draw(_ p: PageSpec, in ctx: CGContext) {
    let r = CGRect(x: 0, y: 0, width: p.w, height: p.h)
    ctx.setFillColor(UIColor(hex: p.bg).cgColor)
    ctx.fill(r)
    if p.kind == "pdf", let doc = ArtCache.shared.pdf(p.file), let page = doc.page(at: p.index + 1) {
      ctx.saveGState()
      ctx.setFillColor(UIColor.white.cgColor)
      ctx.fill(r)
      ctx.translateBy(x: 0, y: r.height)
      ctx.scaleBy(x: 1, y: -1)
      ctx.concatenate(page.getDrawingTransform(.cropBox, rect: r, rotate: 0, preserveAspectRatio: true))
      ctx.drawPDFPage(page)
      ctx.restoreGState()
    } else if p.kind == "image", let img = ArtCache.shared.image(p.file) {
      UIGraphicsPushContext(ctx)
      img.draw(in: r)
      UIGraphicsPopContext()
    }
    for m in p.marks {
      ctx.setFillColor(UIColor(hex: m.color).cgColor)
      if m.r > 0 {
        ctx.fillEllipse(in: CGRect(x: m.x - m.r, y: m.y - m.r, width: m.r * 2, height: m.r * 2))
      } else {
        ctx.fill(CGRect(x: m.x, y: m.y, width: m.w, height: m.h))
      }
    }
  }
}

/// Tiles fade in by default; draw them straight away instead.
final class FastTiledLayer: CATiledLayer {
  override class func fadeDuration() -> CFTimeInterval { 0 }
}

/// The sharp, tiled drawing of a page (PDF text and ruling stay crisp when zoomed).
final class PageTiles: UIView {
  override class var layerClass: AnyClass { FastTiledLayer.self }
  let spec: PageSpec

  init(spec: PageSpec) {
    self.spec = spec
    super.init(frame: CGRect(x: 0, y: 0, width: spec.w, height: spec.h))
    isUserInteractionEnabled = false
    isOpaque = false
    backgroundColor = .clear
    if let tl = layer as? CATiledLayer {
      tl.levelsOfDetail = 4
      tl.levelsOfDetailBias = 3
      tl.tileSize = CGSize(width: 512, height: 512)
    }
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func draw(_ rect: CGRect) {
    guard let ctx = UIGraphicsGetCurrentContext() else { return }
    PageArt.draw(spec, in: ctx)
  }
}

/// One page on screen. Underneath: the whole page drawn once as a picture, so it is
/// always there at once (no grey boxes while zooming, resizing or opening a panel);
/// on top: the sharp tiles, which fill in a moment later.
final class PageTileView: UIView {
  let spec: PageSpec
  private let tiles: PageTiles

  init(spec: PageSpec) {
    self.spec = spec
    tiles = PageTiles(spec: spec)
    super.init(frame: CGRect(x: 0, y: 0, width: spec.w, height: spec.h))
    isUserInteractionEnabled = false
    isOpaque = true
    backgroundColor = UIColor(hex: spec.bg)
    layer.contentsGravity = .resize
    tiles.frame = bounds
    tiles.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(tiles)
    drawPreview()
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  private func drawPreview() {
    let s = spec
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      let k = min(2.0, 1600.0 / max(s.w, s.h))
      let fmt = UIGraphicsImageRendererFormat()
      fmt.scale = 1
      fmt.opaque = true
      let img = UIGraphicsImageRenderer(size: CGSize(width: s.w * k, height: s.h * k), format: fmt).image { ctx in
        ctx.cgContext.scaleBy(x: k, y: k)
        PageArt.draw(s, in: ctx.cgContext)
      }
      DispatchQueue.main.async { self?.layer.contents = img.cgImage }
    }
  }
}
