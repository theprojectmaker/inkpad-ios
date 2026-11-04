// The zoom writing window: a box on the page, and a big strip along the bottom of the
// screen where writing lands in that box. Its own ink view mirrors the main one.
import UIKit

final class ZoomWriter: NSObject, UIGestureRecognizerDelegate {
  weak var owner: QuillCanvasView?
  let pad = UIView()
  private let art = UIImageView()
  let ink: InkView
  private let dim = CAShapeLayer()
  private let frameLine = CAShapeLayer()
  private let margin = UIView()
  private let controls = UIStackView()
  var rect: CGRect = .zero
  var capturing = false
  private var dragFrom: CGPoint?
  private var padHeight: CGFloat = 0

  init(owner: QuillCanvasView) {
    self.owner = owner
    ink = InkView(document: owner.document)
    super.init()
    pad.backgroundColor = .white
    pad.clipsToBounds = true
    pad.layer.borderWidth = 1
    pad.layer.borderColor = UIColor(red: 0.8, green: 0.83, blue: 0.9, alpha: 1).cgColor
    art.contentMode = .scaleToFill
    pad.addSubview(art)
    margin.backgroundColor = UIColor(red: 0.25, green: 0.42, blue: 0.95, alpha: 0.2)
    margin.isUserInteractionEnabled = false
    pad.addSubview(ink)
    pad.addSubview(margin)
    dim.fillRule = .evenOdd
    dim.fillColor = UIColor(white: 0, alpha: 0.09).cgColor
    frameLine.fillColor = nil
    frameLine.strokeColor = UIColor(red: 0.25, green: 0.42, blue: 0.95, alpha: 1).cgColor
    frameLine.lineWidth = 2
    controls.axis = .horizontal
    controls.spacing = 2
    controls.backgroundColor = .white
    controls.layer.cornerRadius = 12
    controls.isLayoutMarginsRelativeArrangement = true
    controls.layoutMargins = UIEdgeInsets(top: 2, left: 6, bottom: 2, right: 6)
    let items: [(String, String, Selector)] = [
      ("arrow.left", "Zoom window back", #selector(back)), ("arrow.right", "Zoom window forward", #selector(forward)),
      ("return", "Zoom window new line", #selector(newLine)), ("xmark", "Close zoom window", #selector(close)),
    ]
    for (icon, label, action) in items {
      let b = UIButton(type: .system)
      b.setImage(UIImage(systemName: icon), for: .normal)
      b.tintColor = UIColor(red: 0.23, green: 0.26, blue: 0.32, alpha: 1)
      b.accessibilityLabel = label
      b.contentEdgeInsets = UIEdgeInsets(top: 8, left: 10, bottom: 8, right: 10)
      b.addTarget(self, action: action, for: .touchUpInside)
      controls.addArrangedSubview(b)
    }
    pad.addSubview(controls)
  }

  func attach() {
    guard let o = owner else { return }
    o.layer.addSublayer(dim)
    o.layer.addSublayer(frameLine)
    o.addSubview(pad)
    o.ink.mirror = ink
    let z = max(0.01, o.canvas.zoomScale)
    let w = o.bounds.width * 0.5 / z
    let at = CGPoint(x: (o.canvas.contentOffset.x + o.bounds.width * 0.1) / z, y: (o.canvas.contentOffset.y + o.bounds.height * 0.3) / z)
    layout()
    move(to: CGRect(x: at.x, y: at.y, width: w, height: w * padHeight / max(1, o.bounds.width)))
  }

  func detach() {
    owner?.ink.mirror = nil
    dim.removeFromSuperlayer()
    frameLine.removeFromSuperlayer()
    pad.removeFromSuperview()
    ink.penUp()
  }

  func layout() {
    guard let o = owner else { return }
    padHeight = (o.bounds.height * 0.32).rounded()
    pad.frame = CGRect(x: 0, y: o.bounds.height - padHeight, width: o.bounds.width, height: padHeight)
    art.frame = pad.bounds
    ink.frame = pad.bounds
    margin.frame = CGRect(x: pad.bounds.width * 0.86, y: 0, width: pad.bounds.width * 0.14, height: padHeight)
    let size = controls.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize)
    controls.frame = CGRect(x: pad.bounds.width - size.width - 10, y: 8, width: size.width, height: size.height)
    o.bringSubviewToFront(pad)
    syncBox()
  }

  /// The box on the page, wherever the page has scrolled to.
  func syncBox() {
    guard let o = owner, !rect.isEmpty else { return }
    let r = o.pageHost.convert(rect, to: o)
    let shade = UIBezierPath(rect: CGRect(x: 0, y: 0, width: o.bounds.width, height: o.bounds.height - padHeight))
    shade.append(UIBezierPath(roundedRect: r, cornerRadius: 6))
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    dim.path = shade.cgPath
    frameLine.path = UIBezierPath(roundedRect: r, cornerRadius: 6).cgPath
    CATransaction.commit()
  }

  func move(to r: CGRect) {
    guard let o = owner else { return }
    var n = r
    let content = o.pageHost.bounds
    n.origin.x = max(content.minX, min(content.maxX - n.width, n.origin.x))
    n.origin.y = max(content.minY, min(content.maxY - n.height, n.origin.y))
    rect = n
    syncBox()
    refresh()
  }

  /// Redraws what's under the writing strip.
  func refresh() {
    guard let o = owner, pad.bounds.width > 1, !rect.isEmpty else { return }
    let r = rect
    let size = pad.bounds.size
    let k = size.width / r.width
    let fmt = UIGraphicsImageRendererFormat()
    fmt.scale = 2
    fmt.opaque = true
    art.image = UIGraphicsImageRenderer(size: size, format: fmt).image { c in
      UIColor.white.setFill()
      c.fill(CGRect(origin: .zero, size: size))
      c.cgContext.scaleBy(x: k, y: k)
      for (i, f) in o.frames.enumerated() where f.intersects(r) && i < o.specs.count {
        c.cgContext.saveGState()
        c.cgContext.translateBy(x: f.minX - r.minX, y: f.minY - r.minY)
        PageArt.draw(o.specs[i], in: c.cgContext)
        o.drawPictures(onPage: f, in: c.cgContext)
        o.drawTexts(onPage: f, in: c.cgContext)
        c.cgContext.restoreGState()
      }
    }
    ink.setPad(rect: r, size: size)
  }

  func contains(viewPoint p: CGPoint) -> Bool {
    guard let o = owner else { return false }
    return o.pageHost.convert(rect, to: o).insetBy(dx: -8, dy: -8).contains(p)
  }

  /// Where a touch in the strip lands on the page. nil: it isn't in the strip.
  func map(_ t: UITouch) -> CGPoint? {
    guard capturing else { return nil }
    let p = t.preciseLocation(in: pad)
    let k = rect.width / max(1, pad.bounds.width)
    return CGPoint(x: rect.minX + p.x * k, y: rect.minY + p.y * k)
  }

  func strokeEnded(_ bounds: CGRect) {
    if bounds.maxX > rect.minX + rect.width * 0.86 { forward() }
  }

  @objc func back() { move(to: rect.offsetBy(dx: -rect.width * 0.7, dy: 0)) }

  @objc func forward() {
    guard let o = owner else { return }
    if rect.maxX >= o.pageHost.bounds.maxX - 1 { newLine() } else { move(to: rect.offsetBy(dx: rect.width * 0.7, dy: 0)) }
  }

  @objc func newLine() {
    var n = rect
    n.origin.x = owner?.pageHost.bounds.minX ?? 0
    n.origin.y += n.height * 0.9
    move(to: n)
  }

  @objc func close() {
    owner?.onSelectionAction(["action": "zoomClosed"])
    owner?.setZoomWindow(false)
  }

  /// A finger on the box drags it; elsewhere on the page a tap moves it there.
  func drag(_ g: UIPanGestureRecognizer) {
    guard let o = owner else { return }
    let p = g.location(in: o.pageHost)
    switch g.state {
    case .began: dragFrom = p
    case .changed:
      if let f = dragFrom { move(to: rect.offsetBy(dx: p.x - f.x, dy: p.y - f.y)); dragFrom = p }
    default: dragFrom = nil
    }
  }
}

extension QuillCanvasView {
  func setZoomWindow(_ on: Bool) {
    if on {
      guard zoomWriter == nil, bounds.width > 1 else { return }
      let z = ZoomWriter(owner: self)
      zoomWriter = z
      z.attach()
      keyboardInset = z.pad.frame.height
      zoomPan.isEnabled = true
    } else {
      zoomWriter?.detach()
      zoomWriter = nil
      keyboardInset = 0
      zoomPan.isEnabled = false
    }
    refreshZoomInset()
  }

  @objc func onZoomPan(_ g: UIPanGestureRecognizer) { zoomWriter?.drag(g) }
}

// MARK: - Pinching

/// A pinch moves the pages with Core Animation and the ink with Metal, and the two reach the
/// screen at different moments: the writing lagged behind the page and ran off its edge. So
/// during a pinch the ink is a picture on each page, and they can't come apart.
extension QuillCanvasView {
  private func inkPicture(_ strokes: [InkStroke], page f: CGRect) -> CGImage? {
    let k: CGFloat = 2
    let fmt = UIGraphicsImageRendererFormat()
    fmt.scale = k
    fmt.opaque = false
    let inside = strokes.filter { $0.bounds.intersects(f) }
    if inside.isEmpty { return nil }
    return UIGraphicsImageRenderer(size: f.size, format: fmt).image { InkRaster.draw(inside, rect: f, in: $0.cgContext) }.cgImage
  }

  private func nearPages() -> ClosedRange<Int>? {
    guard !frames.isEmpty else { return nil }
    let i = currentPage()
    return max(0, i - 3)...min(frames.count - 1, i + 3)
  }

  /// Keeps the pictures ready, so a pinch starts without a pause. Called after each save.
  func refreshInkPictures() {
    guard let near = nearPages(), !zoomPreviewing else { return }
    let version = document.version
    let strokes = document.strokes.filter { !$0.lifted }
    let jobs = near.filter { inkPictures[specs[$0].id]?.version != version }.map { (specs[$0].id, frames[$0]) }
    if jobs.isEmpty { return }
    DispatchQueue.global(qos: .utility).async { [weak self] in
      guard let self else { return }
      for (id, f) in jobs {
        let image = autoreleasepool { self.inkPicture(strokes, page: f) }
        DispatchQueue.main.async {
          if self.document.version == version { self.inkPictures[id] = (version, image) }
        }
      }
    }
  }

  func pinchBegan() {
    guard !zoomPreviewing, let near = nearPages() else { return }
    zoomPreviewing = true
    let version = document.version
    let strokes = document.strokes.filter { !$0.lifted }
    for i in near where i < pageViewList.count {
      let id = specs[i].id
      if inkPictures[id]?.version != version { inkPictures[id] = (version, inkPicture(strokes, page: frames[i])) }
      pageViewList[i].showInk(inkPictures[id]?.image)
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    ink.paused = true
    ink.isHidden = true
    CATransaction.commit()
  }

  func pinchEnded() {
    guard zoomPreviewing else { return }
    if canvas.isZooming || canvas.isZoomBouncing {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.03) { [weak self] in self?.pinchEnded() }
      return
    }
    zoomPreviewing = false
    ink.isHidden = false
    ink.resume()
    // The pictures go once the sharp ink has had time to reach the screen.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { [weak self] in
      guard let self, !self.zoomPreviewing else { return }
      self.pageViewList.forEach { $0.showInk(nil) }
    }
  }
}

// MARK: - The colour wheel

/// Apple's colour picker, answering with a hex colour (empty if closed without one).
final class ColorPick: NSObject, UIColorPickerViewControllerDelegate {
  static var current: ColorPick?
  private let done: (String) -> Void
  private var picked = ""

  init(done: @escaping (String) -> Void) { self.done = done }

  static func show(start: String, from vc: UIViewController, done: @escaping (String) -> Void) {
    let session = ColorPick(done: done)
    current = session
    let p = UIColorPickerViewController()
    p.selectedColor = UIColor(hex: start)
    p.supportsAlpha = false
    p.delegate = session
    vc.present(p, animated: true)
  }

  func colorPickerViewControllerDidSelectColor(_ c: UIColorPickerViewController) {
    let rgb = c.selectedColor.inkRGB
    picked = String(format: "#%02X%02X%02X", rgb & 255, rgb >> 8 & 255, rgb >> 16 & 255)
  }

  func colorPickerViewControllerDidFinish(_ c: UIColorPickerViewController) {
    done(picked)
    ColorPick.current = nil
  }
}
