// Typed text boxes on the canvas, and page tools (thumbnails, delete).
import PencilKit
import UIKit

extension QuillCanvasView {
  // MARK: - Text mode

  func setTextMode(_ on: Bool) {
    if textMode == on { return }
    textMode = on
    canvas.drawingGestureRecognizer.isEnabled = !on
    textHost.isUserInteractionEnabled = on
    tapGR.isEnabled = on
    panGR.isEnabled = on
    if !on { commitEdit() }
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
    let b = TextBox(id: UUID().uuidString, x: Double(x), y: Double(max(f.minY + 4, p.y - CGFloat(textSize) * 0.7)), w: Double(w), text: "", size: textSize, color: textColor)
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
      if dragId != nil { dragId = nil; saveTexts() }
    }
  }

  /// The text pan only starts on a text box (otherwise the page scrolls).
  func panStartsOnBox() -> Bool { box(at: panGR.location(in: textHost)) != nil }

  func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
    g === tapGR
  }

  // MARK: - Editing

  private func font(_ size: Double) -> UIFont { UIFont.systemFont(ofSize: CGFloat(size)) }

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
    ed.font = font(b.size)
    ed.textColor = UIColor(hex: b.color)
    ed.text = b.text
    ed.layer.borderColor = UIColor(red: 0.15, green: 0.39, blue: 0.92, alpha: 1).cgColor
    ed.layer.borderWidth = 1.2
    ed.layer.cornerRadius = 4
    ed.overrideUserInterfaceStyle = .light
    let h = max(CGFloat(b.size) * 1.5, ed.sizeThatFits(CGSize(width: CGFloat(b.w), height: 10000)).height)
    ed.frame = CGRect(x: CGFloat(b.x) - 2, y: CGFloat(b.y) - 2, width: CGFloat(b.w) + 4, height: h)
    if ed.superview == nil { textHost.addSubview(ed) }
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
  }

  // MARK: - Labels

  func renderTexts() {
    labels.values.forEach { $0.removeFromSuperview() }
    labels = [:]
    texts.forEach { layoutLabel($0) }
  }

  func layoutLabel(_ b: TextBox) {
    let l = labels[b.id] ?? UILabel()
    l.numberOfLines = 0
    l.font = font(b.size)
    l.textColor = UIColor(hex: b.color)
    l.text = b.text
    let h = l.sizeThatFits(CGSize(width: CGFloat(b.w), height: 10000)).height
    l.frame = CGRect(x: CGFloat(b.x), y: CGFloat(b.y), width: CGFloat(b.w), height: max(h, CGFloat(b.size)))
    l.isHidden = b.id == editingId
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
  func drawTexts(onPage f: CGRect, in ctx: CGContext) {
    UIGraphicsPushContext(ctx)
    for b in texts where f.contains(CGPoint(x: b.x + 1, y: b.y + 1)) {
      let style = NSMutableParagraphStyle()
      style.lineBreakMode = .byWordWrapping
      let attrs: [NSAttributedString.Key: Any] = [.font: font(b.size), .foregroundColor: UIColor(hex: b.color), .paragraphStyle: style]
      (b.text as NSString).draw(with: CGRect(x: CGFloat(b.x) - f.minX, y: CGFloat(b.y) - f.minY, width: CGFloat(b.w), height: 10000),
                                options: [.usesLineFragmentOrigin], attributes: attrs, context: nil)
    }
    UIGraphicsPopContext()
  }

  // MARK: - Page tools

  /// A picture of page `i` (background, ink and text) for the page sidebar or the library.
  func pageThumb(_ i: Int, path: String, width: Double) -> Bool {
    guard i >= 0, i < specs.count, i < frames.count else { return false }
    let p = specs[i], f = frames[i]
    let k = CGFloat(width) / CGFloat(p.w)
    let size = CGSize(width: CGFloat(p.w) * k, height: CGFloat(p.h) * k)
    var ink: UIImage?
    UITraitCollection(userInterfaceStyle: .light).performAsCurrent {
      ink = canvas.drawing.image(from: f, scale: k * 2)
    }
    let fmt = UIGraphicsImageRendererFormat()
    fmt.scale = 2
    let img = UIGraphicsImageRenderer(size: size, format: fmt).image { ctx in
      ctx.cgContext.scaleBy(x: k, y: k)
      PageArt.draw(p, in: ctx.cgContext)
      ink?.draw(in: CGRect(x: 0, y: 0, width: p.w, height: p.h))
      drawTexts(onPage: f, in: ctx.cgContext)
    }
    guard let data = img.jpegData(compressionQuality: 0.8) else { return false }
    let url = URL(fileURLWithPath: path)
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    return (try? data.write(to: url, options: .atomic)) != nil
  }

  /// Makes room for a new page of height `h` right after page `i`: ink and text below it move down.
  func insertPageSpace(after i: Int, height h: Double) {
    guard i >= 0, i < frames.count else { return }
    commitEdit()
    let below = frames[i].maxY + 14
    let shift = CGFloat(h) + 28
    var strokes: [PKStroke] = []
    for var s in canvas.drawing.strokes {
      if s.renderBounds.midY >= below { s.transform = s.transform.concatenating(CGAffineTransform(translationX: 0, y: shift)) }
      strokes.append(s)
    }
    canvas.drawing = PKDrawing(strokes: strokes)
    texts = texts.map { b in var n = b; if CGFloat(b.y) >= below { n.y += Double(shift) }; return n }
    renderTexts()
    saveTexts()
    saveNow(sync: true)
  }

  /// Removes page `i`'s ink and text and moves everything below it up. The app then drops the page.
  func deletePage(_ i: Int) {
    guard i >= 0, i < frames.count else { return }
    commitEdit()
    let f = frames[i]
    let shift = f.height + 28
    let top = f.minY - 14, bottom = f.maxY + 14
    var kept: [PKStroke] = []
    for var s in canvas.drawing.strokes {
      let c = s.renderBounds.midY
      if c >= top && c < bottom { continue }
      if c >= bottom { s.transform = s.transform.concatenating(CGAffineTransform(translationX: 0, y: -shift)) }
      kept.append(s)
    }
    canvas.drawing = PKDrawing(strokes: kept)
    texts = texts.compactMap { b in
      if CGFloat(b.y) >= top && CGFloat(b.y) < bottom { return nil }
      var n = b
      if CGFloat(b.y) >= bottom { n.y -= Double(shift) }
      return n
    }
    renderTexts()
    saveTexts()
    saveNow(sync: true)
  }
}
