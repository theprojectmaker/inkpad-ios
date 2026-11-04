// The lasso: pick ink, photos and typed text, then move, size, turn, copy, recolour,
// turn writing into text, or ask the AI about it.
import UIKit
import Vision

enum SelDragMode { case move, size, rotate }

/// What Copy put away (works across notes). Everything is in canvas coordinates.
enum InkClipboard {
  static var strokes: [InkStroke] = []
  static var texts: [TextBox] = []
  static var pics: [PictureObj] = []
  static var picDir: URL?
  static var changeCount = -1
}

extension QuillCanvasView {
  var hasSelection: Bool { !selection.isEmpty || !selTexts.isEmpty || !selPics.isEmpty }

  // MARK: - Drawing the lasso

  func beginLasso(_ p: CGPoint) {
    if hasSelection {
      if beginDragSelection(at: p) { return }
      clearSelection()
    }
    lassoPts = [p]
    lassoLayer.isHidden = false
    drawLassoLine()
  }

  func moveLasso(_ p: CGPoint) {
    if selDrag != nil { dragSelection(to: p); return }
    if lassoBox { lassoPts = [lassoPts.first ?? p, p] } else { lassoPts.append(p) }
    drawLassoLine()
  }

  func endLasso() {
    if selDrag != nil { selDrag = nil; return }
    lassoLayer.isHidden = true
    defer { lassoPts = [] }
    guard let first = lassoPts.first, let last = lassoPts.last else { return }
    let tapped = lassoBox ? hypot(first.x - last.x, first.y - last.y) * canvas.zoomScale < 8 : lassoPts.count <= 3
    if tapped { pickObject(at: last); return }
    let area = CGMutablePath()
    if lassoBox {
      area.addRect(CGRect(x: min(first.x, last.x), y: min(first.y, last.y), width: abs(first.x - last.x), height: abs(first.y - last.y)))
    } else {
      area.addLines(between: lassoPts)
      area.closeSubpath()
    }
    let box = area.boundingBoxOfPath
    let picked = document.strokes.filter { s in
      guard s.bounds.intersects(box) else { return false }
      let inside = s.pts.reduce(0) { $0 + (area.contains(CGPoint(x: CGFloat($1.x), y: CGFloat($1.y))) ? 1 : 0) }
      return inside * 2 >= s.pts.count
    }
    let tids = texts.filter { b in
      guard let f = labels[b.id]?.frame else { return false }
      return area.contains(CGPoint(x: f.midX, y: f.midY))
    }.map(\.id)
    let pids = pics.filter { area.contains(CGPoint(x: $0.x + $0.w / 2, y: $0.y + $0.h / 2)) }.map(\.id)
    select(picked, texts: tids, pics: pids)
  }

  /// A tap picks the photo or text box under it.
  private func pickObject(at p: CGPoint) {
    if let b = texts.last(where: { labels[$0.id]?.frame.insetBy(dx: -6, dy: -6).contains(p) ?? false }) {
      select([], texts: [b.id], pics: [])
    } else if let o = pics.last(where: { pictureContains($0, p) }) {
      select([], texts: [], pics: [o.id])
    }
  }

  private func drawLassoLine() {
    let path = CGMutablePath()
    if lassoBox, let a = lassoPts.first, let b = lassoPts.last {
      let c1 = pageHost.convert(a, to: self), c2 = pageHost.convert(b, to: self)
      path.addRect(CGRect(x: min(c1.x, c2.x), y: min(c1.y, c2.y), width: abs(c1.x - c2.x), height: abs(c1.y - c2.y)))
    } else {
      path.addLines(between: lassoPts.map { pageHost.convert($0, to: self) })
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    lassoLayer.path = path
    CATransaction.commit()
  }

  // MARK: - The selection

  func select(_ strokes: [InkStroke], texts tids: [String] = [], pics pids: [String] = []) {
    selection = strokes
    selTexts = tids
    selPics = pids
    guard hasSelection else { selPan.isEnabled = false; return }
    strokes.forEach { $0.lifted = true }
    ink.lifted = strokes
    var box = strokes.reduce(CGRect.null) { $0.union($1.bounds) }
    for id in tids { if let f = labels[id]?.frame { box = box.union(f) } }
    for o in pics where pids.contains(o.id) { box = box.union(pictureBounds(o)) }
    selBox = box
    ink.liftedTransform = .identity
    selPan.isEnabled = true
    ink.setNeedsInk(rebuild: true)
    placeSelectionUI()
  }

  /// Lets go of the selection, leaving it where it was moved to.
  func clearSelection() {
    guard hasSelection else { return }
    commitSelection()
    selection.forEach { $0.lifted = false }
    selection = []
    selTexts = []
    selPics = []
    ink.lifted = []
    selDrag = nil
    clearSelectionUI()
    ink.setNeedsInk(rebuild: true)
  }

  /// Makes the current move / size / turn permanent (and one undo step).
  private func commitSelection() {
    let t = ink.liftedTransform
    let k = sqrt(abs(t.a * t.d - t.b * t.c))
    ink.liftedTransform = .identity
    selBox = selBox.applying(t)
    let picked = selection
    if t == .identity { resetSelectedViews(); return }
    let moved = picked.map { $0.moved(t) }
    document.apply(removed: picked, added: moved)
    for i in texts.indices where selTexts.contains(texts[i].id) {
      let b = texts[i]
      let f = labels[b.id]?.bounds.size ?? CGSize(width: b.w, height: b.size)
      let c = CGPoint(x: CGFloat(b.x) + f.width / 2, y: CGFloat(b.y) + f.height / 2).applying(t)
      texts[i].w = b.w * Double(k)
      texts[i].size = b.size * Double(k)
      reformat(&texts[i], scale: k)
      texts[i].x = Double(c.x - f.width * k / 2)
      texts[i].y = Double(c.y - f.height * k / 2)
    }
    let turn = atan2(t.b, t.a)
    for i in pics.indices where selPics.contains(pics[i].id) {
      let o = pics[i]
      let c = CGPoint(x: o.x + o.w / 2, y: o.y + o.h / 2).applying(t)
      pics[i].w = o.w * Double(k)
      pics[i].h = o.h * Double(k)
      pics[i].x = Double(c.x) - pics[i].w / 2
      pics[i].y = Double(c.y) - pics[i].h / 2
      pics[i].rot = o.rot + Double(turn)
    }
    resetSelectedViews()
    selection = moved
    moved.forEach { $0.lifted = true }
    ink.lifted = moved
    finishObjects(removed: picked, added: moved)
  }

  /// Puts photos and labels back to their saved place (they follow the selection with a transform while dragging).
  private func resetSelectedViews() {
    for id in selTexts { labels[id]?.transform = .identity }
    renderTexts()
    renderPictures()
  }

  /// One undo step: these strokes changed, plus whatever happened to text, photos and tape.
  func finishObjects(removed: [InkStroke], added: [InkStroke]) {
    let now = currentObjects()
    let changed = now != objBase
    let e = InkEdit(removed: removed, added: added, objects: changed ? (objBase, now) : nil)
    objBase = now
    if changed { saveTexts(); saveExtras() }
    record(e)
  }

  private func selectionTransformed(_ p: CGPoint) -> CGPoint { p.applying(ink.liftedTransform) }

  private var corners: (tl: CGPoint, tr: CGPoint, br: CGPoint, bl: CGPoint) {
    (selectionTransformed(CGPoint(x: selBox.minX, y: selBox.minY)), selectionTransformed(CGPoint(x: selBox.maxX, y: selBox.minY)),
     selectionTransformed(CGPoint(x: selBox.maxX, y: selBox.maxY)), selectionTransformed(CGPoint(x: selBox.minX, y: selBox.maxY)))
  }

  private func viewPoint(_ p: CGPoint) -> CGPoint { pageHost.convert(p, to: self) }

  /// Where the turning handle sits, in this view's coordinates.
  private func rotateHandlePoint() -> CGPoint {
    let c = corners
    let a = viewPoint(c.tr), b = viewPoint(c.br), left = viewPoint(c.tl), low = viewPoint(c.bl)
    let mid = CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2)
    let back = CGPoint(x: (left.x + low.x) / 2, y: (left.y + low.y) / 2)
    let dx = mid.x - back.x, dy = mid.y - back.y
    let l = max(1, hypot(dx, dy))
    return CGPoint(x: mid.x + dx / l * 30, y: mid.y + dy / l * 30)
  }

  private func handleHit(_ p: CGPoint) -> Bool {
    let a = viewPoint(p), b = viewPoint(corners.br)
    return hypot(a.x - b.x, a.y - b.y) < 30
  }

  private func rotateHit(_ p: CGPoint) -> Bool {
    let a = viewPoint(p), b = rotateHandlePoint()
    return hypot(a.x - b.x, a.y - b.y) < 28
  }

  private func insideSelection(_ p: CGPoint) -> Bool {
    let pad = 12 / max(0.01, canvas.zoomScale)
    return selBox.insetBy(dx: -pad, dy: -pad).contains(p.applying(ink.liftedTransform.inverted()))
  }

  /// Starts moving (inside the box), sizing (its corner) or turning (the handle on top). False if `p` missed them all.
  private func beginDragSelection(at p: CGPoint) -> Bool {
    if rotateHit(p) {
      selDrag = (p, ink.liftedTransform, .rotate)
    } else if handleHit(p) {
      selDrag = (p, ink.liftedTransform, .size)
    } else if insideSelection(p) {
      selDrag = (p, ink.liftedTransform, .move)
    } else {
      return false
    }
    return true
  }

  private func about(_ c: CGPoint, _ m: CGAffineTransform) -> CGAffineTransform {
    CGAffineTransform(translationX: -c.x, y: -c.y).concatenating(m).concatenating(CGAffineTransform(translationX: c.x, y: c.y))
  }

  private func dragSelection(to p: CGPoint) {
    guard let d = selDrag else { return }
    switch d.mode {
    case .size:
      // Sizes from the opposite corner, keeping the proportions.
      let tl = CGPoint(x: selBox.minX, y: selBox.minY).applying(d.base)
      let br = CGPoint(x: selBox.maxX, y: selBox.maxY).applying(d.base)
      let k = max(0.1, hypot(p.x - tl.x, p.y - tl.y) / max(1, hypot(br.x - tl.x, br.y - tl.y)))
      ink.liftedTransform = d.base.concatenating(about(tl, CGAffineTransform(scaleX: k, y: k)))
    case .rotate:
      let c = CGPoint(x: selBox.midX, y: selBox.midY).applying(d.base)
      var a = atan2(p.y - c.y, p.x - c.x) - atan2(d.from.y - c.y, d.from.x - c.x)
      // Settles on straight when it's close.
      let total = atan2(d.base.b, d.base.a) + a
      let nearest = (total / (.pi / 2)).rounded() * (.pi / 2)
      if abs(total - nearest) < 0.04 { a += nearest - total }
      ink.liftedTransform = d.base.concatenating(about(c, CGAffineTransform(rotationAngle: a)))
    case .move:
      ink.liftedTransform = d.base.concatenating(CGAffineTransform(translationX: p.x - d.from.x, y: p.y - d.from.y))
    }
    followSelection()
    placeSelectionUI()
    ink.drawNow()
  }

  /// Photos and text boxes follow the selection while it's dragged.
  private func followSelection() {
    let t = ink.liftedTransform
    for id in selTexts {
      guard let l = labels[id] else { continue }
      let c = l.center
      l.transform = CGAffineTransform(translationX: c.x, y: c.y).concatenating(t).concatenating(CGAffineTransform(translationX: -c.x, y: -c.y))
    }
    for o in pics where selPics.contains(o.id) {
      guard let v = picViews[o.id] else { continue }
      let c = v.center
      v.transform = CGAffineTransform(rotationAngle: CGFloat(o.rot))
        .concatenating(CGAffineTransform(translationX: c.x, y: c.y)).concatenating(t).concatenating(CGAffineTransform(translationX: -c.x, y: -c.y))
    }
  }

  /// A finger can move a selection too (fingers otherwise scroll the page).
  func selectionWantsTouch(at viewPoint: CGPoint) -> Bool {
    guard hasSelection else { return false }
    let p = pageHost.convert(viewPoint, from: self)
    return rotateHit(p) || handleHit(p) || insideSelection(p)
  }

  @objc func onSelPan(_ g: UIPanGestureRecognizer) {
    let p = g.location(in: pageHost)
    switch g.state {
    case .began: _ = beginDragSelection(at: p)
    case .changed: dragSelection(to: p)
    default: selDrag = nil
    }
  }

  @objc func onSelTap(_ g: UITapGestureRecognizer) {
    let at = g.location(in: self)
    if hasSelection {
      if !selectionWantsTouch(at: at) { clearSelection() }
    } else if inkMode == .lasso {
      pickObject(at: pageHost.convert(at, from: self))
    }
  }

  // MARK: - The buttons

  @objc func onSelDelete() {
    commitSelection()
    let picked = selection
    let tids = selTexts, pids = selPics
    picked.forEach { $0.lifted = false }
    selection = []; selTexts = []; selPics = []
    ink.lifted = []
    clearSelectionUI()
    document.apply(removed: picked, added: [])
    texts.removeAll { tids.contains($0.id) }
    pics.removeAll { pids.contains($0.id) }
    renderTexts()
    renderPictures()
    finishObjects(removed: picked, added: [])
    ink.setNeedsInk(rebuild: true)
  }

  private func copies(_ strokes: [InkStroke], _ tb: [TextBox], _ pb: [PictureObj], by shift: CGPoint) {
    let t = CGAffineTransform(translationX: shift.x, y: shift.y)
    let newStrokes = strokes.map { s -> InkStroke in
      let m = s.moved(t)
      return InkStroke(pts: m.pts, rgb: m.rgb, kind: m.kind, seq: document.nextSeq())
    }
    let newTexts = tb.map { b -> TextBox in
      var n = b; n.id = UUID().uuidString; n.x += Double(shift.x); n.y += Double(shift.y); return n
    }
    let newPics = pb.map { o -> PictureObj in
      var n = o; n.id = UUID().uuidString; n.x += Double(shift.x); n.y += Double(shift.y); return n
    }
    document.apply(removed: [], added: newStrokes)
    texts.append(contentsOf: newTexts)
    pics.append(contentsOf: newPics)
    renderTexts()
    renderPictures()
    finishObjects(removed: [], added: newStrokes)
    select(newStrokes, texts: newTexts.map(\.id), pics: newPics.map(\.id))
  }

  @objc func onSelDuplicate() {
    commitSelection()
    let s = selection
    let tb = texts.filter { selTexts.contains($0.id) }
    let pb = pics.filter { selPics.contains($0.id) }
    clearSelection()
    copies(s, tb, pb, by: CGPoint(x: 24, y: 24))
  }

  @objc func onSelCopy() {
    commitSelection()
    InkClipboard.strokes = selection
    InkClipboard.texts = texts.filter { selTexts.contains($0.id) }
    InkClipboard.pics = pics.filter { selPics.contains($0.id) }
    InkClipboard.picDir = noteFolder
    if let img = selectionImage() { UIPasteboard.general.image = img }
    InkClipboard.changeCount = UIPasteboard.general.changeCount
    selectionMessage("Copied")
  }

  @objc func onSelCut() {
    onSelCopy()
    onSelDelete()
    InkClipboard.changeCount = UIPasteboard.general.changeCount
  }

  /// Puts what was copied (here or in another app) in the middle of the screen.
  func paste() {
    clearSelection()
    let z = max(0.01, canvas.zoomScale)
    let middle = CGPoint(x: (canvas.contentOffset.x + canvas.bounds.width / 2) / z, y: (canvas.contentOffset.y + canvas.bounds.height / 2) / z)
    if UIPasteboard.general.changeCount == InkClipboard.changeCount, !InkClipboard.strokes.isEmpty || !InkClipboard.texts.isEmpty || !InkClipboard.pics.isEmpty {
      var box = InkClipboard.strokes.reduce(CGRect.null) { $0.union($1.bounds) }
      for b in InkClipboard.texts { box = box.union(CGRect(x: b.x, y: b.y, width: b.w, height: b.size * 1.4)) }
      for o in InkClipboard.pics { box = box.union(pictureBounds(o)) }
      // Photos from another note bring their file along.
      if let from = InkClipboard.picDir, let to = noteFolder, from != to {
        for o in InkClipboard.pics where !FileManager.default.fileExists(atPath: to.appendingPathComponent(o.file).path) {
          try? FileManager.default.copyItem(at: from.appendingPathComponent(o.file), to: to.appendingPathComponent(o.file))
        }
      }
      copies(InkClipboard.strokes, InkClipboard.texts, InkClipboard.pics, by: CGPoint(x: middle.x - box.midX, y: middle.y - box.midY))
      return
    }
    if let img = UIPasteboard.general.image, let dir = noteFolder, let data = img.jpegData(compressionQuality: 0.88) {
      let name = "pic_\(UUID().uuidString).jpg"
      try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      guard (try? data.write(to: dir.appendingPathComponent(name), options: .atomic)) != nil else { return }
      addPicture(name, width: Double(img.size.width), height: Double(img.size.height))
      return
    }
    if let s = UIPasteboard.general.string, !s.isEmpty {
      let b = TextBox(id: UUID().uuidString, x: Double(middle.x) - 160, y: Double(middle.y), w: 320, text: s, size: textSize, color: textColor, font: textFont, bold: textBold)
      texts.append(b)
      renderTexts()
      finishObjects(removed: [], added: [])
      select([], texts: [b.id], pics: [])
      return
    }
    selectionMessage("Nothing to paste")
  }

  private func recolor(_ hex: String) {
    commitSelection()
    let rgb = UIColor(hex: hex).inkRGB
    let old = selection
    let new = old.map { InkStroke(pts: $0.pts, rgb: rgb, kind: $0.kind, seq: $0.seq, ts: $0.ts) }
    document.apply(removed: old, added: new)
    for i in texts.indices where selTexts.contains(texts[i].id) { texts[i].color = hex; reformat(&texts[i], color: UIColor(hex: hex)) }
    renderTexts()
    selection = new
    new.forEach { $0.lifted = true }
    ink.lifted = new
    finishObjects(removed: old, added: new)
    ink.setNeedsInk(rebuild: true)
  }

  /// The selection as a picture on white, for reading, sharing and the AI.
  func selectionImage() -> UIImage? {
    let t = ink.liftedTransform
    let strokes = selection.map { t == .identity ? $0 : $0.moved(t) }
    let box = selBox.applying(t).insetBy(dx: -10, dy: -10)
    guard box.width > 1, box.height > 1 else { return nil }
    let fmt = UIGraphicsImageRendererFormat()
    fmt.scale = 3
    fmt.opaque = true
    return UIGraphicsImageRenderer(size: box.size, format: fmt).image { c in
      UIColor.white.setFill()
      c.fill(CGRect(origin: .zero, size: box.size))
      drawPictures(only: selPics, onPage: box, in: c.cgContext)
      InkRaster.draw(strokes, rect: box, in: c.cgContext)
      drawTexts(only: selTexts, onPage: box, in: c.cgContext)
    }
  }

  private func selectionFile() -> String? {
    guard let img = selectionImage(), let data = img.jpegData(compressionQuality: 0.9) else { return nil }
    let url = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("quill_sel_\(UUID().uuidString).jpg")
    return (try? data.write(to: url, options: .atomic)) != nil ? url.path : nil
  }

  @objc func onSelShare() {
    guard let path = selectionFile() else { return }
    onSelectionAction(["action": "share", "path": path])
  }

  /// Asks the app to read the selection and show a preview.
  private func convert(_ kind: String) {
    guard let path = selectionFile() else { return }
    onSelectionAction(["action": "convert", "text": kind, "path": path])
  }

  /// From the preview: the writing becomes this typed text (Undo brings the writing back).
  func replaceSelection(text: String) {
    commitSelection()
    let picked = selection
    guard !picked.isEmpty else { return }
    let box = selBox
    let lines = max(1, text.components(separatedBy: "\n").count)
    let size = max(12, min(44, Double(box.height) / Double(lines) * 0.62))
    let rgb = picked.first?.rgb ?? 0x111111
    let hex = String(format: "#%02X%02X%02X", rgb & 255, rgb >> 8 & 255, rgb >> 16 & 255)
    let b = TextBox(id: UUID().uuidString, x: Double(box.minX), y: Double(box.minY), w: Double(max(120, box.width * 1.15)), text: text, size: size, color: hex, font: textFont, bold: textBold)
    picked.forEach { $0.lifted = false }
    selection = []; selTexts = []; selPics = []
    ink.lifted = []
    clearSelectionUI()
    document.apply(removed: picked, added: [])
    texts.append(b)
    renderTexts()
    finishObjects(removed: picked, added: [])
    ink.setNeedsInk(rebuild: true)
  }

  @objc func onSelExplain() {
    guard let path = selectionFile() else { return }
    onSelectionAction(["action": "explain", "path": path])
  }

  func selectionMessage(_ text: String) { onSelectionAction(["action": "message", "text": text]) }

  /// Handwriting in the selection becomes a typed text box (Undo brings the writing back).
  @objc func onSelToText() {
    commitSelection()
    guard !selection.isEmpty, let img = selectionImage()?.cgImage else { return }
    let picked = selection
    let box = selBox.applying(ink.liftedTransform)
    selectionMessage("Reading your writing…")
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      let req = VNRecognizeTextRequest()
      req.recognitionLevel = .accurate
      req.usesLanguageCorrection = true
      try? VNImageRequestHandler(cgImage: img, options: [:]).perform([req])
      let lines = (req.results ?? []).sorted { $0.boundingBox.maxY > $1.boundingBox.maxY }.compactMap { $0.topCandidates(1).first?.string }
      DispatchQueue.main.async {
        guard let self, self.selection.first === picked.first else { return }
        let text = lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { self.selectionMessage("Couldn't read any writing there"); return }
        let size = max(12, min(44, Double(box.height) / Double(max(1, lines.count)) * 0.62))
        let rgb = picked.first?.rgb ?? 0x111111
        let hex = String(format: "#%02X%02X%02X", rgb & 255, rgb >> 8 & 255, rgb >> 16 & 255)
        let b = TextBox(id: UUID().uuidString, x: Double(box.minX), y: Double(box.minY), w: Double(max(120, box.width * 1.15)), text: text, size: size, color: hex, font: self.textFont, bold: self.textBold)
        picked.forEach { $0.lifted = false }
        self.selection = []; self.selTexts = []; self.selPics = []
        self.ink.lifted = []
        self.clearSelectionUI()
        self.document.apply(removed: picked, added: [])
        self.texts.append(b)
        self.renderTexts()
        self.finishObjects(removed: picked, added: [])
        self.ink.setNeedsInk(rebuild: true)
      }
    }
  }

  func clearSelectionUI() {
    selPan.isEnabled = false
    selOutline.isHidden = true
    selHandle.isHidden = true
    selBar.isHidden = true
  }

  /// Keeps the box, handles and buttons on the selection as it or the page moves.
  func placeSelectionUI() {
    guard hasSelection else { return }
    let c = corners
    let v = [viewPoint(c.tl), viewPoint(c.tr), viewPoint(c.br), viewPoint(c.bl)]
    let top = CGPoint(x: (v[1].x + v[2].x) / 2, y: (v[1].y + v[2].y) / 2)
    let knob = rotateHandlePoint()
    let outline = UIBezierPath()
    outline.move(to: v[0])
    v.dropFirst().forEach { outline.addLine(to: $0) }
    outline.close()
    outline.move(to: top)
    outline.addLine(to: knob)
    let handles = UIBezierPath(ovalIn: CGRect(x: v[2].x - 8, y: v[2].y - 8, width: 16, height: 16))
    handles.append(UIBezierPath(ovalIn: CGRect(x: v[0].x - 8, y: v[0].y - 8, width: 16, height: 16)))
    handles.append(UIBezierPath(ovalIn: CGRect(x: knob.x - 7, y: knob.y - 7, width: 14, height: 14)))
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    selOutline.isHidden = false
    selOutline.path = outline.cgPath
    selHandle.isHidden = false
    selHandle.path = handles.cgPath
    CATransaction.commit()
    selBar.isHidden = false
    bringSubviewToFront(selBar)
    let size = selBar.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize)
    // Right under the toolbar, wherever the selection is.
    selBar.frame = CGRect(x: (bounds.width - size.width) / 2, y: 100, width: size.width, height: size.height)
  }

  @objc func onSelStyle() {
    let rgb = selection.first?.rgb ?? 0x111111
    let n = max(1, selection.reduce(0) { $0 + $1.pts.count })
    let total = selection.reduce(Float(0)) { sum, s in s.pts.reduce(sum) { $0 + $1.r } }
    onSelectionAction(["action": "style", "text": String(format: "#%02X%02X%02X", rgb & 255, rgb >> 8 & 255, rgb >> 16 & 255), "width": Double(total / Float(n)) * 2])
  }

  /// From the Style popover. Empty or zero leaves that part as it is.
  func styleSelection(color: String, width: Double, style: String) {
    commitSelection()
    let rgb = color.isEmpty ? nil : UIColor(hex: color).inkRGB
    let old = selection
    let new = old.map { s -> InkStroke in
      var pts = s.pts
      if width > 0 {
        let avg = pts.reduce(Float(0)) { $0 + $1.r } / Float(max(1, pts.count))
        let k = Float(width / 2) / max(0.05, avg)
        pts = pts.map { InkPoint(x: $0.x, y: $0.y, r: $0.r * k, a: $0.a) }
      }
      var kind = s.kind
      if style == "dash" { kind = .dash } else if style == "dot" { kind = .dot } else if !style.isEmpty && (s.kind == .dash || s.kind == .dot) { kind = .pen }
      return InkStroke(pts: pts, rgb: rgb ?? s.rgb, kind: kind, seq: s.seq, ts: s.ts)
    }
    document.apply(removed: old, added: new)
    if !color.isEmpty { for i in texts.indices where selTexts.contains(texts[i].id) { texts[i].color = color; reformat(&texts[i], color: UIColor(hex: color)) } }
    renderTexts()
    selection = new
    new.forEach { $0.lifted = true }
    ink.lifted = new
    var box = new.reduce(CGRect.null) { $0.union($1.bounds) }
    for id in selTexts { if let f = labels[id]?.frame { box = box.union(f) } }
    for o in pics where selPics.contains(o.id) { box = box.union(pictureBounds(o)) }
    selBox = box
    finishObjects(removed: old, added: new)
    ink.setNeedsInk(rebuild: true)
    placeSelectionUI()
  }

  private func colourMenu() -> UIMenu {
    let names: [(String, String)] = [("Black", "#111111"), ("Blue", "#1E5EFF"), ("Red", "#E5322D"), ("Green", "#0AA35B"), ("Orange", "#F28C18"), ("Purple", "#8E44EC"), ("Grey", "#6E6E6E"), ("White", "#FFFFFF")]
    return UIMenu(children: names.map { n in
      let swatch = UIGraphicsImageRenderer(size: CGSize(width: 22, height: 22)).image { c in
        UIColor(hex: n.1).setFill()
        c.cgContext.fillEllipse(in: CGRect(x: 1, y: 1, width: 20, height: 20))
      }.withRenderingMode(.alwaysOriginal)
      return UIAction(title: n.0, image: swatch) { [weak self] _ in self?.recolor(n.1) }
    })
  }

  func makeSelectionUI() {
    let blue = UIColor(red: 0, green: 0.48, blue: 1, alpha: 1)
    for l in [lassoLayer, selOutline] {
      l.fillColor = nil
      l.strokeColor = blue.cgColor
      l.lineWidth = 1.5
      l.lineDashPattern = [6, 5]
      l.isHidden = true
      layer.addSublayer(l)
    }
    selHandle.fillColor = blue.cgColor
    selHandle.strokeColor = UIColor.white.cgColor
    selHandle.lineWidth = 1.5
    selHandle.isHidden = true
    layer.addSublayer(selHandle)
    eraserRing.fillColor = UIColor(white: 1, alpha: 0.35).cgColor
    eraserRing.strokeColor = UIColor(white: 0.25, alpha: 0.7).cgColor
    eraserRing.lineWidth = 1
    eraserRing.isHidden = true
    layer.addSublayer(eraserRing)

    selBar.axis = .horizontal
    selBar.spacing = 0
    selBar.backgroundColor = .white
    selBar.layer.cornerRadius = 22
    selBar.layer.shadowColor = UIColor.black.cgColor
    selBar.layer.shadowOpacity = 0.16
    selBar.layer.shadowRadius = 12
    selBar.layer.shadowOffset = CGSize(width: 0, height: 3)
    selBar.isLayoutMarginsRelativeArrangement = true
    selBar.layoutMargins = UIEdgeInsets(top: 0, left: 8, bottom: 0, right: 8)
    selBar.isHidden = true
    let make = { (title: String) -> UIButton in
      let b = UIButton(type: .system)
      b.setTitle(title, for: .normal)
      b.setTitleColor(UIColor(white: 0.1, alpha: 1), for: .normal)
      b.titleLabel?.font = .systemFont(ofSize: 15)
      b.contentEdgeInsets = UIEdgeInsets(top: 11, left: 12, bottom: 11, right: 12)
      return b
    }
    let divider = { () -> UIView in
      let d = UIView()
      d.backgroundColor = UIColor(white: 0.85, alpha: 1)
      d.translatesAutoresizingMaskIntoConstraints = false
      d.widthAnchor.constraint(equalToConstant: 1).isActive = true
      d.heightAnchor.constraint(equalToConstant: 18).isActive = true
      return d
    }
    selBar.alignment = .center
    let actions: [(String, Selector)] = [("Style", #selector(onSelStyle)), ("Duplicate", #selector(onSelDuplicate)), ("Cut", #selector(onSelCut)), ("Copy", #selector(onSelCopy)), ("Delete", #selector(onSelDelete))]
    for (title, action) in actions {
      let b = make(title)
      b.addTarget(self, action: action, for: .touchUpInside)
      selBar.addArrangedSubview(b)
      selBar.addArrangedSubview(divider())
    }
    let convert = make("Convert ›")
    convert.accessibilityLabel = "Convert"
    convert.menu = UIMenu(children: [
      UIAction(title: "Text") { [weak self] _ in self?.convert("text") },
      UIAction(title: "Math") { [weak self] _ in self?.convert("math") },
      UIAction(title: "Graph") { [weak self] _ in self?.convert("graph") },
      UIAction(title: "Explain with AI") { [weak self] _ in self?.onSelExplain() },
      UIAction(title: "Share as a picture") { [weak self] _ in self?.onSelShare() },
    ])
    convert.showsMenuAsPrimaryAction = true
    selBar.addArrangedSubview(convert)
    addSubview(selBar)
  }
}
