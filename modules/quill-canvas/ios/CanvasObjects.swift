// Things that sit on the page besides ink: photos you can move and turn, study tape,
// the laser pointer, a brief highlight for search results, and tapping ink to hear
// what was being said when it was written.
import UIKit

/// A photo on the page, in canvas coordinates. x, y, w, h describe it before it's turned.
struct PictureObj: Codable, Equatable {
  var id: String
  var file: String
  var x: Double
  var y: Double
  var w: Double
  var h: Double
  var rot: Double
}

/// Study tape: a straight strip that hides what's under it until it's tapped.
struct TapeObj: Codable, Equatable {
  var id: String
  var x1: Double
  var y1: Double
  var x2: Double
  var y2: Double
  var w: Double
  var color: String
  var shown: Bool
}

struct InkExtras: Codable {
  var pics: [PictureObj] = []
  var tapes: [TapeObj] = []
}

/// Everything on the page that isn't ink, for undo.
struct InkObjects: Equatable {
  var texts: [TextBox]
  var pics: [PictureObj]
  var tapes: [TapeObj]
}

extension QuillCanvasView {
  var noteFolder: URL? {
    guard let p = textsPath, !p.isEmpty else { return nil }
    return URL(fileURLWithPath: p).deletingLastPathComponent()
  }

  private var extrasURL: URL? { noteFolder?.appendingPathComponent("extras.json") }

  func currentObjects() -> InkObjects { InkObjects(texts: texts, pics: pics, tapes: tapes) }

  func loadExtras() {
    if let url = extrasURL, let data = try? Data(contentsOf: url), let e = try? JSONDecoder().decode(InkExtras.self, from: data) {
      pics = e.pics
      tapes = e.tapes
    }
    renderPictures()
    renderTapes()
    objBase = currentObjects()
  }

  func saveExtras() {
    guard let url = extrasURL else { return }
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    if let data = try? JSONEncoder().encode(InkExtras(pics: pics, tapes: tapes)) { try? data.write(to: url, options: .atomic) }
  }

  /// Text, photos or tape changed: one undo step, and saved.
  func objectsChanged() {
    let now = currentObjects()
    guard now != objBase else { return }
    let before = objBase
    objBase = now
    saveTexts()
    saveExtras()
    record(InkEdit(removed: [], added: [], objects: (before, now)))
  }

  func restoreObjects(_ o: InkObjects) {
    texts = o.texts
    pics = o.pics
    tapes = o.tapes
    objBase = o
    renderTexts()
    renderPictures()
    renderTapes()
    saveTexts()
    saveExtras()
  }

  // MARK: - Photos

  func pictureBounds(_ o: PictureObj) -> CGRect {
    let c = CGPoint(x: o.x + o.w / 2, y: o.y + o.h / 2)
    let r = CGAffineTransform(rotationAngle: CGFloat(o.rot))
    let box = CGRect(x: -o.w / 2, y: -o.h / 2, width: o.w, height: o.h).applying(r)
    return box.offsetBy(dx: c.x, dy: c.y)
  }

  func pictureContains(_ o: PictureObj, _ p: CGPoint) -> Bool {
    let c = CGPoint(x: o.x + o.w / 2, y: o.y + o.h / 2)
    let q = CGPoint(x: p.x - c.x, y: p.y - c.y).applying(CGAffineTransform(rotationAngle: CGFloat(-o.rot)))
    return abs(q.x) <= o.w / 2 && abs(q.y) <= o.h / 2
  }

  private func pictureImage(_ file: String) -> UIImage? {
    guard let dir = noteFolder else { return nil }
    return UIImage(contentsOfFile: dir.appendingPathComponent(file).path)
  }

  func renderPictures() {
    let keep = Set(pics.map(\.id))
    for (id, v) in picViews where !keep.contains(id) { v.removeFromSuperview(); picViews[id] = nil }
    for o in pics {
      let v = picViews[o.id] ?? {
        let n = UIImageView(image: pictureImage(o.file))
        n.contentMode = .scaleToFill
        n.clipsToBounds = true
        n.layer.minificationFilter = .trilinear
        n.isUserInteractionEnabled = false
        pictureHost.addSubview(n)
        picViews[o.id] = n
        return n
      }()
      v.transform = .identity
      v.frame = CGRect(x: o.x, y: o.y, width: o.w, height: o.h)
      v.transform = CGAffineTransform(rotationAngle: CGFloat(o.rot))
      pictureHost.bringSubviewToFront(v)
    }
  }

  /// A new photo in the middle of what's on screen, already picked up so it can be placed.
  func addPicture(_ file: String, width: Double, height: Double) {
    guard width > 0, height > 0 else { return }
    let z = max(0.01, canvas.zoomScale)
    let middle = CGPoint(x: (canvas.contentOffset.x + canvas.bounds.width / 2) / z, y: (canvas.contentOffset.y + canvas.bounds.height / 2) / z)
    let page = frames.first(where: { $0.insetBy(dx: 0, dy: -14).contains(CGPoint(x: $0.midX, y: middle.y)) }) ?? frames.first ?? CGRect(x: 0, y: 0, width: 612, height: 792)
    let w = min(Double(page.width) * 0.6, 380, width)
    let h = w * height / width
    clearSelection()
    let o = PictureObj(id: UUID().uuidString, file: file, x: Double(middle.x) - w / 2, y: Double(middle.y) - h / 2, w: w, h: h, rot: 0)
    pics.append(o)
    renderPictures()
    objectsChanged()
    select([], texts: [], pics: [o.id])
  }

  /// Draws the photos centred on page `f`, with the page's corner at the context's origin.
  func drawPictures(only ids: [String]? = nil, onPage f: CGRect, in ctx: CGContext) {
    for o in pics where ids?.contains(o.id) ?? f.contains(CGPoint(x: o.x + o.w / 2, y: o.y + o.h / 2)) {
      guard let img = pictureImage(o.file) else { continue }
      ctx.saveGState()
      ctx.translateBy(x: CGFloat(o.x + o.w / 2) - f.minX, y: CGFloat(o.y + o.h / 2) - f.minY)
      ctx.rotate(by: CGFloat(o.rot))
      UIGraphicsPushContext(ctx)
      img.draw(in: CGRect(x: -o.w / 2, y: -o.h / 2, width: o.w, height: o.h))
      UIGraphicsPopContext()
      ctx.restoreGState()
    }
  }

  // MARK: - Tape

  func renderTapes() {
    let keep = Set(tapes.map(\.id))
    for (id, v) in tapeViews where !keep.contains(id) { v.removeFromSuperview(); tapeViews[id] = nil }
    for o in tapes {
      let v = tapeViews[o.id] ?? {
        let n = UIView()
        n.layer.cornerRadius = 3
        n.isUserInteractionEnabled = false
        tapeHost.addSubview(n)
        tapeViews[o.id] = n
        return n
      }()
      place(v, tape: o)
    }
  }

  private func place(_ v: UIView, tape o: TapeObj) {
    let dx = o.x2 - o.x1, dy = o.y2 - o.y1
    v.transform = .identity
    v.bounds = CGRect(x: 0, y: 0, width: hypot(dx, dy) + o.w * 0.4, height: o.w)
    v.center = CGPoint(x: (o.x1 + o.x2) / 2, y: (o.y1 + o.y2) / 2)
    v.transform = CGAffineTransform(rotationAngle: atan2(dy, dx))
    v.backgroundColor = QuillCanvasView.stripes(UIColor(hex: o.color))
    v.alpha = o.shown ? 0.18 : 1
    v.layer.borderWidth = 0.6
    v.layer.borderColor = UIColor(white: 0.55, alpha: o.shown ? 0.9 : 0.5).cgColor
  }

  /// The tape's colour with thin white diagonal stripes.
  static func stripes(_ c: UIColor) -> UIColor {
    let size: CGFloat = 12
    let img = UIGraphicsImageRenderer(size: CGSize(width: size, height: size)).image { ctx in
      c.setFill()
      ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))
      let g = ctx.cgContext
      g.setStrokeColor(UIColor(white: 1, alpha: 0.75).cgColor)
      g.setLineWidth(1.6)
      for off in [-size, 0, size] {
        g.move(to: CGPoint(x: off, y: size))
        g.addLine(to: CGPoint(x: off + size, y: 0))
      }
      g.strokePath()
    }
    return UIColor(patternImage: img)
  }

  private func tapeContains(_ o: TapeObj, _ p: CGPoint, slack: CGFloat = 0) -> Bool {
    let d = InkStroke.distance(p, CGPoint(x: o.x1, y: o.y1), CGPoint(x: o.x2, y: o.y2))
    return d <= CGFloat(o.w) / 2 + slack
  }

  func tapeAt(_ p: CGPoint) -> Int? { tapes.lastIndex { tapeContains($0, p) } }

  func beginTape(_ p: CGPoint) {
    tapeStart = p
    let v = UIView()
    v.backgroundColor = UIColor(hex: tapeColor)
    v.alpha = 0.85
    v.layer.cornerRadius = 3
    tapeHost.addSubview(v)
    tapeDraft = v
    moveTape(p)
  }

  /// Straight lines only; nearly level means level.
  private func tapeEnd(_ p: CGPoint) -> CGPoint {
    let angle = atan2(p.y - tapeStart.y, p.x - tapeStart.x)
    let level = (angle / .pi).rounded() * .pi
    return abs(angle - level) < 0.14 ? CGPoint(x: p.x, y: tapeStart.y) : p
  }

  func moveTape(_ p: CGPoint) {
    guard let v = tapeDraft else { return }
    let e = tapeEnd(p)
    place(v, tape: TapeObj(id: "", x1: tapeStart.x, y1: tapeStart.y, x2: e.x, y2: e.y, w: Double(tapeWidth), color: tapeColor, shown: false))
    v.alpha = 0.85
    v.layer.borderWidth = 0
  }

  func endTape(_ p: CGPoint) {
    tapeDraft?.removeFromSuperview()
    tapeDraft = nil
    let e = tapeEnd(p)
    if hypot(e.x - tapeStart.x, e.y - tapeStart.y) * canvas.zoomScale < 10 {
      if let i = tapeAt(p) { toggleTape(i) }
      return
    }
    tapes.append(TapeObj(id: UUID().uuidString, x1: tapeStart.x, y1: tapeStart.y, x2: e.x, y2: e.y, w: Double(tapeWidth), color: tapeColor, shown: false))
    renderTapes()
    objectsChanged()
  }

  private func toggleTape(_ i: Int) {
    tapes[i].shown.toggle()
    UIView.animate(withDuration: 0.16) { self.renderTapes() }
    // Peeking isn't a change to the note, so it isn't an undo step.
    objBase = currentObjects()
    saveExtras()
  }

  func setAllTape(shown: Bool) {
    for i in tapes.indices { tapes[i].shown = shown }
    UIView.animate(withDuration: 0.16) { self.renderTapes() }
    objBase = currentObjects()
    saveExtras()
  }

  func clearTape() {
    tapes = []
    renderTapes()
    objectsChanged()
  }

  /// The eraser removes tape it crosses.
  func eraseTape(at p: CGPoint, radius: CGFloat) {
    let before = tapes.count
    tapes.removeAll { tapeContains($0, p, slack: radius) }
    if tapes.count != before { renderTapes() }
  }

  @objc func onTapeTap(_ g: UITapGestureRecognizer) {
    if let i = tapeAt(g.location(in: tapeHost)) { toggleTape(i) }
  }

  // MARK: - Laser pointer

  func beginLaser(_ p: CGPoint) {
    laserPts.append((pageHost.convert(p, to: self), CACurrentMediaTime()))
    if laserLink == nil {
      laserLayer.fillColor = nil
      laserLayer.strokeColor = laserColor.cgColor
      laserLayer.lineWidth = 5
      laserLayer.lineCap = .round
      laserLayer.lineJoin = .round
      laserLayer.shadowColor = laserColor.cgColor
      laserLayer.shadowOpacity = 0.9
      laserLayer.shadowRadius = 8
      laserLayer.shadowOffset = .zero
      if laserLayer.superlayer == nil { layer.addSublayer(laserLayer) }
      let l = CADisplayLink(target: self, selector: #selector(laserTick))
      l.add(to: .main, forMode: .common)
      laserLink = l
    }
    laserBreaks.append(laserPts.count - 1)
  }

  func moveLaser(_ p: CGPoint) { laserPts.append((pageHost.convert(p, to: self), CACurrentMediaTime())) }

  @objc private func laserTick() {
    let now = CACurrentMediaTime()
    let keep = laserPts.firstIndex { now - $0.1 < 0.9 } ?? laserPts.count
    if keep > 0 {
      laserPts.removeFirst(keep)
      laserBreaks = laserBreaks.map { $0 - keep }.filter { $0 >= 0 }
    }
    let path = CGMutablePath()
    for (i, q) in laserPts.enumerated() {
      if i == 0 || laserBreaks.contains(i) { path.move(to: q.0) } else { path.addLine(to: q.0) }
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    laserLayer.path = path
    CATransaction.commit()
    if laserPts.isEmpty && capture == nil && !laserDown {
      laserLink?.invalidate()
      laserLink = nil
    }
  }

  // MARK: - Search results

  /// Brings part of a page into view and flashes it. x, y, w, h are 0...1 of the page.
  func flash(page i: Int, x: Double, y: Double, w: Double, h: Double) {
    guard i >= 0, i < frames.count else { return }
    let f = frames[i]
    let r = CGRect(x: f.minX + CGFloat(x) * f.width, y: f.minY + CGFloat(y) * f.height, width: CGFloat(w) * f.width, height: CGFloat(h) * f.height).insetBy(dx: -4, dy: -3)
    let z = canvas.zoomScale
    let maxY = max(-canvas.contentInset.top, canvas.contentSize.height - canvas.bounds.height + canvas.contentInset.bottom)
    let target = min(maxY, max(-canvas.contentInset.top, r.midY * z - canvas.bounds.height * 0.4))
    canvas.setContentOffset(CGPoint(x: canvas.contentOffset.x, y: target), animated: true)
    let v = UIView(frame: r)
    v.backgroundColor = UIColor(red: 1, green: 0.85, blue: 0.1, alpha: 0.5)
    v.layer.cornerRadius = 3
    v.isUserInteractionEnabled = false
    tapeHost.addSubview(v)
    UIView.animate(withDuration: 0.5, delay: 2.2, options: []) { v.alpha = 0 } completion: { _ in v.removeFromSuperview() }
  }

  // MARK: - Tap ink to hear it

  func setInkTaps(_ on: Bool) { inkTapGR.isEnabled = on }

  @objc func onInkTap(_ g: UITapGestureRecognizer) {
    let p = g.location(in: pageHost)
    let reach = 14 / max(0.01, canvas.zoomScale)
    var best: (d: CGFloat, ts: Double)?
    for s in document.strokes where s.ts > 0 && s.bounds.insetBy(dx: -reach, dy: -reach).contains(p) {
      for q in s.pts {
        let d = hypot(CGFloat(q.x) - p.x, CGFloat(q.y) - p.y)
        if d < reach && d < (best?.d ?? .greatestFiniteMagnitude) { best = (d, s.ts) }
      }
    }
    if let best { onInkTapped(["ts": best.ts]) }
  }

  func setReplay(cut: Double, from: Double, to: Double) {
    ink.setReplay(cut < 0 ? nil : (cut, from, to))
  }
}

extension QuillCanvasView: UIPencilInteractionDelegate {
  /// Double-tap on the Apple Pencil, following what the iPad's Settings ask for.
  func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
    let action: String
    switch UIPencilInteraction.preferredTapAction {
    case .switchEraser: action = "eraser"
    case .switchPrevious: action = "previous"
    case .showColorPalette, .showInkAttributes: action = "options"
    default: action = "none"
    }
    onPencilTap(["action": action])
  }
}
