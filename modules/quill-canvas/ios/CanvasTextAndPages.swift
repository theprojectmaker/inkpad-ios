// Typed text boxes on the canvas, and page tools (thumbnails, delete).
import UIKit

extension QuillCanvasView {
  // MARK: - Text mode

  func setTextMode(_ on: Bool) {
    if textMode == on { return }
    textMode = on
    inkGesture.isEnabled = !on
    updatePanFingers()
    textHost.isUserInteractionEnabled = on
    tapGR.isEnabled = on
    panGR.isEnabled = on
    if !on { commitEdit() }
    placeTextHost()
  }

  /// Typed text sits above the ink only while you type. When you write, nothing covers
  /// the ink.
  func placeTextHost() {
    if textMode {
      if canvas.subviews.last !== textHost { canvas.bringSubviewToFront(textHost) }
    } else if let i = canvas.subviews.firstIndex(of: textHost), let p = canvas.subviews.firstIndex(of: pageHost), i != p + 1 {
      canvas.insertSubview(textHost, aboveSubview: pageHost)
    }
  }

  func box(at p: CGPoint) -> TextBox? {
    texts.last(where: { b in labels[b.id]?.frame.insetBy(dx: -8, dy: -8).contains(p) ?? false })
  }

  @objc func onTextTap(_ gr: UITapGestureRecognizer) {
    let p = gr.location(in: textHost)
    if editingId != nil {
      if let ed = editor, ed.frame.insetBy(dx: -6, dy: -6).contains(p) { return }
      commitEdit()
      return
    }
    if let b = box(at: p) { beginEdit(b); return }
    // A new box where you tapped, on the page you tapped.
    guard let f = frames.first(where: { $0.insetBy(dx: 0, dy: -4).contains(p) }) else { return }
    let x = max(f.minX + 8, min(p.x, f.maxX - 120))
    let w = max(120, min(360, f.maxX - x - 16))
    let b = TextBox(id: UUID().uuidString, x: Double(x), y: Double(max(f.minY + 4, p.y - CGFloat(textSize) * 0.7)), w: Double(w), text: "", size: textSize, color: textColor, font: textFont, bold: textBold)
    texts.append(b)
    beginEdit(b)
  }

  @objc func onTextPan(_ gr: UIPanGestureRecognizer) {
    let p = gr.location(in: textHost)
    switch gr.state {
    case .began:
      if editingId != nil { commitEdit() }
      dragId = box(at: p)?.id
      dragStart = p
    case .changed:
      guard let id = dragId, let i = texts.firstIndex(where: { $0.id == id }) else { return }
      let d = CGPoint(x: p.x - dragStart.x, y: p.y - dragStart.y)
      dragStart = p
      texts[i].x += Double(d.x)
      texts[i].y += Double(d.y)
      layoutLabel(texts[i])
    default:
      if dragId != nil { dragId = nil; saveTexts(); objectsChanged() }
    }
  }

  /// The text pan only starts on a text box (otherwise the page scrolls).
  func panStartsOnBox() -> Bool { box(at: panGR.location(in: textHost)) != nil }

  func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
    g === tapGR || g === inkGesture || other === inkGesture || g === tapeTap || g === inkTapGR
  }

  // MARK: - Editing

  func font(_ b: TextBox) -> UIFont { QuillCanvasView.makeFont(b.font, size: CGFloat(b.size), bold: b.bold ?? false) }

  static func makeFont(_ name: String?, size: CGFloat, bold: Bool) -> UIFont {
    let weight: UIFont.Weight = bold ? .bold : .regular
    let plain = UIFont.systemFont(ofSize: size, weight: weight)
    switch name {
    case "serif": return UIFont(name: bold ? "Georgia-Bold" : "Georgia", size: size) ?? plain
    case "mono": return UIFont.monospacedSystemFont(ofSize: size, weight: weight)
    case "hand": return UIFont(name: bold ? "Noteworthy-Bold" : "Noteworthy-Light", size: size) ?? plain
    case "round":
      if let d = plain.fontDescriptor.withDesign(.rounded) { return UIFont(descriptor: d, size: size) }
      return plain
    default: return plain
    }
  }

  /// Picking a colour, size or font while typing changes the box being typed in.
  func restyleEditor() {
    guard let id = editingId, let ed = editor, let i = texts.firstIndex(where: { $0.id == id }) else { return }
    texts[i].color = textColor
    texts[i].size = textSize
    texts[i].font = textFont
    texts[i].bold = textBold
    ed.font = font(texts[i])
    ed.textColor = UIColor(hex: textColor)
    textViewDidChange(ed)
  }

  private func beginEdit(_ b: TextBox) {
    editingId = b.id
    labels[b.id]?.isHidden = true
    let ed = editor ?? UITextView()
    editor = ed
    ed.delegate = self
    ed.backgroundColor = UIColor.white.withAlphaComponent(0.6)
    ed.textContainerInset = UIEdgeInsets(top: 2, left: 2, bottom: 2, right: 2)
    ed.textContainer.lineFragmentPadding = 0
    ed.isScrollEnabled = false
    ed.font = font(b)
    ed.textColor = UIColor(hex: b.color)
    ed.text = b.text
    ed.layer.borderColor = UIColor(red: 0.15, green: 0.39, blue: 0.92, alpha: 1).cgColor
    ed.layer.borderWidth = 1.2
    ed.layer.cornerRadius = 4
    ed.overrideUserInterfaceStyle = .light
    let h = max(CGFloat(b.size) * 1.5, ed.sizeThatFits(CGSize(width: CGFloat(b.w), height: 10000)).height)
    ed.frame = CGRect(x: CGFloat(b.x) - 2, y: CGFloat(b.y) - 2, width: CGFloat(b.w) + 4, height: h)
    if ed.superview == nil { textHost.addSubview(ed) }
    ed.contentScaleFactor = textScale()
    ed.becomeFirstResponder()
  }

  func textViewDidChange(_ textView: UITextView) {
    let w = textView.frame.width
    let h = max(textView.font?.lineHeight ?? 20, textView.sizeThatFits(CGSize(width: w, height: 10000)).height)
    textView.frame.size.height = h
  }

  func commitEdit() {
    guard let id = editingId, let ed = editor else { return }
    editingId = nil
    let text = ed.text ?? ""
    ed.resignFirstResponder()
    ed.removeFromSuperview()
    if let i = texts.firstIndex(where: { $0.id == id }) {
      if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        texts.remove(at: i)
        labels[id]?.removeFromSuperview()
        labels[id] = nil
      } else {
        texts[i].text = text
        layoutLabel(texts[i])
      }
    }
    saveTexts()
    objectsChanged()
  }

  // MARK: - Labels

  /// Text is drawn at the zoom it's shown at, so it stays sharp (not a blown-up bitmap).
  func textScale() -> CGFloat { min(8, UIScreen.main.scale * max(1, canvas.zoomScale)) }
  func updateTextScale() {
    let s = textScale()
    for l in labels.values where abs(l.contentScaleFactor - s) > 0.01 { l.contentScaleFactor = s; l.setNeedsDisplay() }
    if let ed = editor { ed.contentScaleFactor = s; ed.subviews.forEach { $0.contentScaleFactor = s } }
  }

  /// Moves all ink and text sideways (when the pages are re-centred).
  func shiftAll(dx: CGFloat) {
    clearSelection()
    document.replaceAll(document.strokes.map { $0.moved(CGAffineTransform(translationX: dx, y: 0)) })
    undoStack.removeAll(); redoStack.removeAll()
    ink.setNeedsInk(rebuild: true)
    markDirty()
    texts = texts.map { b in var n = b; n.x += Double(dx); return n }
    pics = pics.map { o in var n = o; n.x += Double(dx); return n }
    tapes = tapes.map { o in var n = o; n.x1 += Double(dx); n.x2 += Double(dx); return n }
    objBase = currentObjects()
    renderTexts()
    renderPictures()
    renderTapes()
    saveTexts()
    saveExtras()
    saveNow(sync: true)
  }

  func renderTexts() {
    labels.values.forEach { $0.removeFromSuperview() }
    labels = [:]
    texts.forEach { layoutLabel($0) }
  }

  func layoutLabel(_ b: TextBox) {
    let l = labels[b.id] ?? UILabel()
    l.numberOfLines = 0
    l.font = font(b)
    l.textColor = UIColor(hex: b.color)
    l.text = b.text
    let h = l.sizeThatFits(CGSize(width: CGFloat(b.w), height: 10000)).height
    l.frame = CGRect(x: CGFloat(b.x), y: CGFloat(b.y), width: CGFloat(b.w), height: max(h, CGFloat(b.size)))
    l.isHidden = b.id == editingId
    l.contentScaleFactor = textScale()
    if l.superview == nil { textHost.addSubview(l) }
    labels[b.id] = l
  }

  func saveTexts() {
    guard let path = textsPath, !path.isEmpty else { return }
    let url = URL(fileURLWithPath: path)
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    if let data = try? JSONEncoder().encode(texts) { try? data.write(to: url, options: .atomic) }
    emitState()
  }

  /// Draws the text boxes that sit on the page with frame `f`, page origin at (0, 0).
  func drawTexts(only ids: [String]? = nil, onPage f: CGRect, in ctx: CGContext) {
    UIGraphicsPushContext(ctx)
    for b in texts where ids?.contains(b.id) ?? f.contains(CGPoint(x: b.x + 1, y: b.y + 1)) {
      let style = NSMutableParagraphStyle()
      style.lineBreakMode = .byWordWrapping
      let attrs: [NSAttributedString.Key: Any] = [.font: font(b), .foregroundColor: UIColor(hex: b.color), .paragraphStyle: style]
      (b.text as NSString).draw(with: CGRect(x: CGFloat(b.x) - f.minX, y: CGFloat(b.y) - f.minY, width: CGFloat(b.w), height: 10000),
                                options: [.usesLineFragmentOrigin], attributes: attrs, context: nil)
    }
    UIGraphicsPopContext()
  }

  // MARK: - Page tools

  /// A picture of page `i` (background, ink and text) for the page sidebar or the library.
  func pageThumb(_ i: Int, path: String, width: Double) -> Bool {
    guard i >= 0, i < specs.count, i < frames.count else { return false }
    commitEdit()
    let p = specs[i], f = frames[i]
    let k = CGFloat(width) / CGFloat(p.w)
    let size = CGSize(width: CGFloat(p.w) * k, height: CGFloat(p.h) * k)
    let strokes = document.strokes
    let fmt = UIGraphicsImageRendererFormat()
    fmt.scale = 2
    let img = UIGraphicsImageRenderer(size: size, format: fmt).image { ctx in
      ctx.cgContext.scaleBy(x: k, y: k)
      PageArt.draw(p, in: ctx.cgContext)
      drawPictures(onPage: f, in: ctx.cgContext)
      InkRaster.draw(strokes, rect: f, in: ctx.cgContext)
      drawTexts(onPage: f, in: ctx.cgContext)
    }
    guard let data = img.jpegData(compressionQuality: 0.8) else { return false }
    let url = URL(fileURLWithPath: path)
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    return (try? data.write(to: url, options: .atomic)) != nil
  }

  /// Moves everything on the pages. `shift` takes an item's vertical position in the old
  /// layout and says how far it moves; nil removes it.
  private func remapContent(_ shift: (CGFloat) -> CGFloat?) {
    commitEdit()
    clearSelection()
    var kept: [InkStroke] = []
    kept.reserveCapacity(document.strokes.count)
    for s in document.strokes {
      guard let d = shift(s.bounds.midY) else { continue }
      kept.append(d == 0 ? s : s.moved(CGAffineTransform(translationX: 0, y: d)))
    }
    document.replaceAll(kept)
    texts = texts.compactMap { b in
      guard let d = shift(CGFloat(b.y)) else { return nil }
      var n = b; n.y += Double(d); return n
    }
    pics = pics.compactMap { o in
      guard let d = shift(CGFloat(o.y + o.h / 2)) else { return nil }
      var n = o; n.y += Double(d); return n
    }
    tapes = tapes.compactMap { o in
      guard let d = shift(CGFloat((o.y1 + o.y2) / 2)) else { return nil }
      var n = o; n.y1 += Double(d); n.y2 += Double(d); return n
    }
    contentMoved()
  }

  private func contentMoved() {
    undoStack.removeAll(); redoStack.removeAll()
    objBase = currentObjects()
    ink.setNeedsInk(rebuild: true)
    markDirty()
    renderTexts()
    renderPictures()
    renderTapes()
    saveTexts()
    saveExtras()
    saveNow(sync: true)
  }

  /// Makes room for a new page of height `h` right after page `i`: everything below it moves down.
  func insertPageSpace(after i: Int, height h: Double) {
    guard i >= 0, i < frames.count else { return }
    let below = frames[i].maxY + 14
    let d = CGFloat(h) + 28
    remapContent { $0 >= below ? d : 0 }
  }

  /// Removes page `i`'s content and moves everything below it up. The app then drops the page.
  func deletePage(_ i: Int) {
    guard i >= 0, i < frames.count else { return }
    let f = frames[i]
    let d = f.height + 28
    let top = f.minY - 14, bottom = f.maxY + 14
    remapContent { y in
      if y >= top && y < bottom { return nil }
      return y >= bottom ? -d : 0
    }
  }

  /// Nothing written or placed on page `i` (its background doesn't count).
  func pageIsEmpty(_ i: Int) -> Bool {
    guard i >= 0, i < frames.count else { return false }
    commitEdit()
    let f = frames[i]
    let top = f.minY - 14, bottom = f.maxY + 14
    let inside = { (y: CGFloat) in y >= top && y < bottom }
    return !document.strokes.contains { inside($0.bounds.midY) } && !texts.contains { inside(CGFloat($0.y)) }
      && !pics.contains { inside(CGFloat($0.y + $0.h / 2)) } && !tapes.contains { inside(CGFloat(($0.y1 + $0.y2) / 2)) }
  }

  /// Page `i` is changing height by `delta`: everything below it moves with it.
  func resizePage(_ i: Int, delta: Double) {
    guard i >= 0, i < frames.count, delta != 0 else { return }
    let below = frames[i].maxY + 14
    let d = CGFloat(delta)
    remapContent { $0 >= below ? d : 0 }
  }

  /// Tells the app once when the last page gets written on, so a blank page can follow it.
  func checkLastPage() {
    guard autoPage, let f = frames.last, frames.count != lastPageAsked, !pageIsEmptyFast(f) else { return }
    lastPageAsked = frames.count
    onLastPageUsed([:])
  }

  private func pageIsEmptyFast(_ f: CGRect) -> Bool {
    let top = f.minY - 14
    if let s = document.strokes.last, s.bounds.midY >= top { return false }
    if document.strokes.contains(where: { $0.bounds.midY >= top }) { return false }
    return !texts.contains { CGFloat($0.y) >= top } && !pics.contains { CGFloat($0.y + $0.h / 2) >= top }
  }

  /// Moves page `from` so it becomes page `to`, with everything on it. The app then reorders its pages.
  func movePage(from: Int, to: Int) {
    guard from >= 0, from < frames.count, to >= 0, to < frames.count, from != to else { return }
    var order = Array(frames.indices)
    order.remove(at: from)
    order.insert(from, at: to)
    var top = [CGFloat](repeating: 0, count: frames.count)
    var y: CGFloat = 0
    for k in order { top[k] = y; y += frames[k].height + 28 }
    let old = frames
    remapContent { at in
      let k = old.firstIndex { at < $0.maxY + 14 } ?? old.count - 1
      return top[k] - old[k].minY
    }
  }

  /// Copies page `i`'s content onto a new page of the same size right after it. The app adds the page.
  func duplicatePage(_ i: Int) {
    guard i >= 0, i < frames.count else { return }
    commitEdit()
    clearSelection()
    let f = frames[i]
    let top = f.minY - 14, bottom = f.maxY + 14
    let inside = { (y: CGFloat) in y >= top && y < bottom }
    let d = f.height + 28
    let strokes = document.strokes.filter { inside($0.bounds.midY) }
    let tb = texts.filter { inside(CGFloat($0.y)) }
    let pb = pics.filter { inside(CGFloat($0.y + $0.h / 2)) }
    let tp = tapes.filter { inside(CGFloat(($0.y1 + $0.y2) / 2)) }
    insertPageSpace(after: i, height: Double(f.height))
    let shift = CGAffineTransform(translationX: 0, y: d)
    document.apply(removed: [], added: strokes.map { s in
      let m = s.moved(shift)
      return InkStroke(pts: m.pts, rgb: m.rgb, kind: m.kind, seq: document.nextSeq())
    })
    texts += tb.map { b in var n = b; n.id = UUID().uuidString; n.y += Double(d); return n }
    pics += pb.map { o in var n = o; n.id = UUID().uuidString; n.y += Double(d); return n }
    tapes += tp.map { o in var n = o; n.id = UUID().uuidString; n.y1 += Double(d); n.y2 += Double(d); return n }
    contentMoved()
  }
}
