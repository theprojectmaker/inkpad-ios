// Formatting typed text: the bar above the keyboard works on the selected words (or what
// you type next), and the small bar under a text box acts on the whole box.
import UIKit

extension QuillCanvasView {
  // MARK: - Rich text kept with each box

  /// The box's text with its formatting.
  func attributed(_ b: TextBox) -> NSAttributedString {
    if let s = b.rtf, let d = Data(base64Encoded: s),
       let a = try? NSAttributedString(data: d, options: [.documentType: NSAttributedString.DocumentType.rtf], documentAttributes: nil) { return a }
    return NSAttributedString(string: b.text, attributes: [.font: font(b), .foregroundColor: UIColor(hex: b.color), .underlineStyle: b.underline == true ? NSUnderlineStyle.single.rawValue : 0])
  }

  func rtfString(_ a: NSAttributedString) -> String? {
    guard a.length > 0, let d = try? a.data(from: NSRange(location: 0, length: a.length), documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf]) else { return nil }
    return d.base64EncodedString()
  }

  /// Scales (lasso sizing) or recolours the formatting kept with a box.
  func reformat(_ b: inout TextBox, scale: CGFloat = 1, color: UIColor? = nil) {
    guard b.rtf != nil else { return }
    let a = NSMutableAttributedString(attributedString: attributed(b))
    let all = NSRange(location: 0, length: a.length)
    if scale != 1 {
      a.enumerateAttribute(.font, in: all) { v, r, _ in
        if let f = v as? UIFont { a.addAttribute(.font, value: f.withSize(f.pointSize * scale), range: r) }
      }
    }
    if let color { a.addAttribute(.foregroundColor, value: color, range: all) }
    b.rtf = rtfString(a)
  }

  /// The box's fill and border.
  func styleBoxView(_ v: UIView, _ b: TextBox) {
    v.backgroundColor = b.fill.map { UIColor(hex: $0) } ?? .clear
    if b.border == "lined" || b.border == "grid" {
      v.layer.borderWidth = CGFloat(b.borderWidth ?? 1)
      v.layer.borderColor = UIColor(hex: b.borderColor ?? "#8C8C8C").cgColor
    } else {
      v.layer.borderWidth = 0
    }
    if b.border == "grid" {
      let line = UIColor(hex: b.borderColor ?? "#8C8C8C").withAlphaComponent(0.5)
      v.backgroundColor = UIColor(patternImage: UIGraphicsImageRenderer(size: CGSize(width: 18, height: 18)).image { c in
        (b.fill.map { UIColor(hex: $0) } ?? .white).setFill()
        c.fill(CGRect(x: 0, y: 0, width: 18, height: 18))
        line.setFill()
        c.fill(CGRect(x: 0, y: 17.5, width: 18, height: 0.5))
        c.fill(CGRect(x: 17.5, y: 0, width: 0.5, height: 18))
      })
    } else if b.border == "lined" {
      let line = UIColor(hex: b.borderColor ?? "#8C8C8C").withAlphaComponent(0.5)
      v.backgroundColor = UIColor(patternImage: UIGraphicsImageRenderer(size: CGSize(width: 18, height: 18)).image { c in
        (b.fill.map { UIColor(hex: $0) } ?? .white).setFill()
        c.fill(CGRect(x: 0, y: 0, width: 18, height: 18))
        line.setFill()
        c.fill(CGRect(x: 0, y: 17.5, width: 18, height: 0.5))
      })
    }
  }

  // MARK: - The bar above the keyboard

  private func changeSelection(_ change: (inout [NSAttributedString.Key: Any]) -> Void) {
    guard let ed = editor else { return }
    let r = ed.selectedRange
    if r.length == 0 {
      var t = ed.typingAttributes
      change(&t)
      ed.typingAttributes = t
    } else {
      let a = NSMutableAttributedString(attributedString: ed.attributedText)
      a.enumerateAttributes(in: r) { attrs, sub, _ in
        var n = attrs
        change(&n)
        a.setAttributes(n, range: sub)
      }
      ed.attributedText = a
      ed.selectedRange = r
    }
    textViewDidChange(ed)
    syncFormatBar()
  }

  private func currentFont() -> UIFont {
    guard let ed = editor else { return .systemFont(ofSize: 14) }
    if ed.selectedRange.length > 0, ed.selectedRange.location < ed.attributedText.length,
       let f = ed.attributedText.attribute(.font, at: ed.selectedRange.location, effectiveRange: nil) as? UIFont { return f }
    return (ed.typingAttributes[.font] as? UIFont) ?? .systemFont(ofSize: 14)
  }

  private func toggleTrait(_ trait: UIFontDescriptor.SymbolicTraits) {
    changeSelection { a in
      let f = (a[.font] as? UIFont) ?? .systemFont(ofSize: 14)
      var traits = f.fontDescriptor.symbolicTraits
      if traits.contains(trait) { traits.remove(trait) } else { traits.insert(trait) }
      if let d = f.fontDescriptor.withSymbolicTraits(traits) { a[.font] = UIFont(descriptor: d, size: f.pointSize) }
    }
  }

  private func setFamily(_ name: String) {
    changeSelection { a in
      let f = (a[.font] as? UIFont) ?? .systemFont(ofSize: 14)
      let t = f.fontDescriptor.symbolicTraits
      a[.font] = QuillCanvasView.makeFont(name, size: f.pointSize, bold: t.contains(.traitBold))
    }
  }

  private func setSize(_ s: CGFloat) {
    changeSelection { a in
      let f = (a[.font] as? UIFont) ?? .systemFont(ofSize: 14)
      a[.font] = f.withSize(max(6, min(144, s)))
    }
  }

  private func setParagraph(_ align: NSTextAlignment) {
    guard let ed = editor else { return }
    let style = NSMutableParagraphStyle()
    style.alignment = align
    let a = NSMutableAttributedString(attributedString: ed.attributedText)
    let all = (ed.text as NSString).paragraphRange(for: ed.selectedRange)
    if all.length > 0 { a.addAttribute(.paragraphStyle, value: style, range: all) }
    let keep = ed.selectedRange
    ed.attributedText = a
    ed.selectedRange = keep
    ed.typingAttributes[.paragraphStyle] = style
    textViewDidChange(ed)
  }

  /// Puts a mark at the start of each selected line, or takes it off again.
  private func toggleLines(_ mark: @escaping (Int) -> String) {
    guard let ed = editor else { return }
    let ns = ed.text as NSString
    let range = ns.paragraphRange(for: ed.selectedRange)
    let a = NSMutableAttributedString(attributedString: ed.attributedText)
    let attrs = ed.typingAttributes
    var lines: [NSRange] = []
    ns.enumerateSubstrings(in: range, options: .byParagraphs) { _, r, _, _ in if let r = Optional(r) { lines.append(r) } }
    if lines.isEmpty { lines = [NSRange(location: range.location, length: 0)] }
    let has = lines.first.map { ns.substring(with: $0).hasPrefix(mark(0)) } ?? false
    for (i, r) in lines.enumerated().reversed() {
      let m = mark(i)
      if has {
        if ns.substring(with: r).hasPrefix(m) { a.deleteCharacters(in: NSRange(location: r.location, length: (m as NSString).length)) }
      } else {
        a.insert(NSAttributedString(string: m, attributes: attrs), at: r.location)
      }
    }
    ed.attributedText = a
    ed.typingAttributes = attrs
    textViewDidChange(ed)
  }

  private func barButton(_ icon: String?, title: String? = nil, label: String, bold: Bool = false, action: @escaping () -> Void) -> UIButton {
    let b = UIButton(type: .system)
    if let icon { b.setImage(UIImage(systemName: icon), for: .normal) }
    if let title { b.setTitle(title, for: .normal); b.titleLabel?.font = .systemFont(ofSize: 16, weight: bold ? .bold : .regular) }
    b.tintColor = UIColor(red: 0.2, green: 0.23, blue: 0.3, alpha: 1)
    b.accessibilityLabel = label
    b.contentEdgeInsets = UIEdgeInsets(top: 7, left: 9, bottom: 7, right: 9)
    b.addAction(UIAction { _ in action() }, for: .touchUpInside)
    return b
  }

  private func menuChip(_ title: String, label: String, _ menu: UIMenu) -> UIButton {
    let b = UIButton(type: .system)
    b.setTitle(title, for: .normal)
    b.setTitleColor(UIColor(red: 0.2, green: 0.23, blue: 0.3, alpha: 1), for: .normal)
    b.titleLabel?.font = .systemFont(ofSize: 15)
    b.backgroundColor = UIColor(red: 0.925, green: 0.93, blue: 0.945, alpha: 1)
    b.layer.cornerRadius = 8
    b.accessibilityLabel = label
    b.contentEdgeInsets = UIEdgeInsets(top: 7, left: 12, bottom: 7, right: 12)
    b.menu = menu
    b.showsMenuAsPrimaryAction = true
    return b
  }

  private func swatch(_ hex: String) -> UIImage {
    UIGraphicsImageRenderer(size: CGSize(width: 22, height: 22)).image { c in
      UIColor(hex: hex).setFill()
      c.cgContext.fillEllipse(in: CGRect(x: 1, y: 1, width: 20, height: 20))
    }.withRenderingMode(.alwaysOriginal)
  }

  private static let inkNames: [(String, String)] = [("Black", "#000000"), ("Blue", "#0A66F0"), ("Red", "#E01E26"), ("Orange", "#F28C0F"), ("Green", "#0A7A38"), ("Purple", "#9000B8"), ("Grey", "#8C8C8C"), ("White", "#FFFFFF")]

  /// Builds the bar once for the text view.
  func makeFormatBar() -> UIView {
    let bar = UIScrollView(frame: CGRect(x: 0, y: 0, width: 800, height: 50))
    bar.backgroundColor = UIColor(red: 0.975, green: 0.975, blue: 0.985, alpha: 1)
    bar.showsHorizontalScrollIndicator = false
    bar.autoresizingMask = [.flexibleWidth]
    let row = UIStackView()
    row.axis = .horizontal
    row.alignment = .center
    row.spacing = 2
    row.translatesAutoresizingMaskIntoConstraints = false
    bar.addSubview(row)
    NSLayoutConstraint.activate([
      row.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 10), row.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -10),
      row.topAnchor.constraint(equalTo: bar.topAnchor), row.bottomAnchor.constraint(equalTo: bar.bottomAnchor), row.heightAnchor.constraint(equalTo: bar.heightAnchor),
    ])
    let presets: [(String, CGFloat, Bool)] = [("Title", 28, true), ("Heading", 20, true), ("Subheading", 16, true), ("Body", 14, false), ("Caption", 12, false)]
    row.addArrangedSubview(menuChip("Format", label: "Text style", UIMenu(children: presets.map { p in
      UIAction(title: p.0) { [weak self] _ in
        self?.changeSelection { a in
          let f = (a[.font] as? UIFont) ?? .systemFont(ofSize: 14)
          var traits = f.fontDescriptor.symbolicTraits
          if p.2 { traits.insert(.traitBold) } else { traits.remove(.traitBold) }
          let d = f.fontDescriptor.withSymbolicTraits(traits) ?? f.fontDescriptor
          a[.font] = UIFont(descriptor: d, size: p.1)
        }
      }
    })))
    let fonts: [(String, String)] = [("Helvetica", "system"), ("Rounded", "round"), ("Georgia", "serif"), ("Noteworthy", "hand"), ("Menlo", "mono")]
    row.addArrangedSubview(menuChip("Font", label: "Font", UIMenu(children: fonts.map { f in UIAction(title: f.0) { [weak self] _ in self?.setFamily(f.1) } })))
    row.addArrangedSubview(barButton("minus.circle", label: "Smaller") { [weak self] in guard let self else { return }; self.setSize(self.currentFont().pointSize - 1) })
    sizeLabel.font = .monospacedDigitSystemFont(ofSize: 15, weight: .regular)
    sizeLabel.textAlignment = .center
    sizeLabel.widthAnchor.constraint(equalToConstant: 30).isActive = true
    row.addArrangedSubview(sizeLabel)
    row.addArrangedSubview(barButton("plus.circle", label: "Bigger") { [weak self] in guard let self else { return }; self.setSize(self.currentFont().pointSize + 1) })
    let colour = UIButton(type: .system)
    colour.setImage(swatch("#000000"), for: .normal)
    colour.accessibilityLabel = "Text colour"
    colour.contentEdgeInsets = UIEdgeInsets(top: 7, left: 9, bottom: 7, right: 9)
    colour.menu = UIMenu(children: QuillCanvasView.inkNames.map { n in
      UIAction(title: n.0, image: swatch(n.1)) { [weak self, weak colour] _ in
        guard let self else { return }
        colour?.setImage(self.swatch(n.1), for: .normal)
        self.changeSelection { $0[.foregroundColor] = UIColor(hex: n.1) }
      }
    })
    colour.showsMenuAsPrimaryAction = true
    row.addArrangedSubview(colour)
    row.addArrangedSubview(barButton(nil, title: "B", label: "Bold", bold: true) { [weak self] in self?.toggleTrait(.traitBold) })
    row.addArrangedSubview(barButton("italic", label: "Italic") { [weak self] in self?.toggleTrait(.traitItalic) })
    row.addArrangedSubview(barButton("underline", label: "Underline") { [weak self] in
      self?.changeSelection { a in a[.underlineStyle] = ((a[.underlineStyle] as? Int) ?? 0) == 0 ? NSUnderlineStyle.single.rawValue : 0 }
    })
    row.addArrangedSubview(barButton("strikethrough", label: "Strikethrough") { [weak self] in
      self?.changeSelection { a in a[.strikethroughStyle] = ((a[.strikethroughStyle] as? Int) ?? 0) == 0 ? NSUnderlineStyle.single.rawValue : 0 }
    })
    row.addArrangedSubview(barButton("highlighter", label: "Highlight text") { [weak self] in
      self?.changeSelection { a in
        if a[.backgroundColor] == nil { a[.backgroundColor] = UIColor(red: 1, green: 1, blue: 0.55, alpha: 1) } else { a.removeValue(forKey: .backgroundColor) }
      }
    })
    row.addArrangedSubview(barButton("link", label: "Insert hyperlink") { [weak self] in self?.askForLink() })
    row.addArrangedSubview(barButton("checklist", label: "Checklist") { [weak self] in self?.toggleLines { _ in "☐ " } })
    row.addArrangedSubview(barButton("list.bullet", label: "Bulleted list") { [weak self] in self?.toggleLines { _ in "• " } })
    row.addArrangedSubview(barButton("list.number", label: "Numbered list") { [weak self] in self?.toggleLines { i in "\(i + 1). " } })
    row.addArrangedSubview(barButton("increase.indent", label: "Indent") { [weak self] in self?.toggleLines { _ in "    " } })
    row.addArrangedSubview(barButton("text.alignleft", label: "Align left") { [weak self] in self?.setParagraph(.left) })
    row.addArrangedSubview(barButton("text.aligncenter", label: "Align centre") { [weak self] in self?.setParagraph(.center) })
    row.addArrangedSubview(barButton("text.alignright", label: "Align right") { [weak self] in self?.setParagraph(.right) })
    row.addArrangedSubview(barButton("keyboard.chevron.compact.down", label: "Done typing") { [weak self] in self?.commitEdit() })
    return bar
  }

  func syncFormatBar() { sizeLabel.text = "\(Int(currentFont().pointSize))" }

  private func askForLink() {
    guard let ed = editor, let vc = appViewController() else { return }
    let keep = ed.selectedRange
    let a = UIAlertController(title: "Insert hyperlink", message: nil, preferredStyle: .alert)
    a.addTextField { $0.placeholder = "URL"; $0.keyboardType = .URL; $0.autocapitalizationType = .none }
    a.addTextField { [weak ed] t in
      t.placeholder = "Link title"
      if let ed, keep.length > 0 { t.text = (ed.text as NSString).substring(with: keep) }
    }
    a.addAction(UIAlertAction(title: "Close", style: .cancel))
    a.addAction(UIAlertAction(title: "Done", style: .default) { [weak self, weak a] _ in
      guard let self, let ed = self.editor, var url = a?.textFields?[0].text, !url.isEmpty else { return }
      if !url.contains("://") { url = "https://" + url }
      let title = a?.textFields?[1].text ?? url
      let m = NSMutableAttributedString(attributedString: ed.attributedText)
      var attrs = ed.typingAttributes
      attrs[.link] = url
      m.replaceCharacters(in: keep, with: NSAttributedString(string: title.isEmpty ? url : title, attributes: attrs))
      ed.attributedText = m
      self.textViewDidChange(ed)
    })
    vc.present(a, animated: true)
  }

  private func appViewController() -> UIViewController? {
    var vc = window?.rootViewController
    while let p = vc?.presentedViewController { vc = p }
    return vc
  }

  // MARK: - The bar under a text box

  private func editingIndex() -> Int? { editingId.flatMap { id in texts.firstIndex { $0.id == id } } }

  private func changeBox(_ change: (inout TextBox) -> Void) {
    guard let i = editingIndex(), let ed = editor else { return }
    change(&texts[i])
    styleBoxView(ed, texts[i])
    if ed.backgroundColor == .clear { ed.backgroundColor = UIColor.white.withAlphaComponent(0.6) }
  }

  func makeBoxBar() -> UIStackView {
    let bar = UIStackView()
    bar.axis = .horizontal
    bar.spacing = 2
    bar.backgroundColor = .white
    bar.layer.cornerRadius = 14
    bar.layer.shadowColor = UIColor.black.cgColor
    bar.layer.shadowOpacity = 0.14
    bar.layer.shadowRadius = 10
    bar.layer.shadowOffset = CGSize(width: 0, height: 3)
    bar.isLayoutMarginsRelativeArrangement = true
    bar.layoutMargins = UIEdgeInsets(top: 2, left: 6, bottom: 2, right: 6)
    let style = UIButton(type: .system)
    style.setImage(UIImage(systemName: "paintpalette"), for: .normal)
    style.tintColor = UIColor(red: 0.2, green: 0.23, blue: 0.3, alpha: 1)
    style.accessibilityLabel = "Box style"
    style.contentEdgeInsets = UIEdgeInsets(top: 7, left: 9, bottom: 7, right: 9)
    let borders = UIMenu(title: "Border", options: .displayInline, children: [("None", "none"), ("Lined", "lined"), ("Grid", "grid")].map { p in
      UIAction(title: p.0) { [weak self] _ in self?.changeBox { $0.border = p.1 } }
    })
    let widths = UIMenu(title: "Border width", children: [1, 2, 4, 8].map { w in UIAction(title: "\(w)") { [weak self] _ in self?.changeBox { $0.borderWidth = Double(w) } } })
    let edge = UIMenu(title: "Border colour", children: QuillCanvasView.inkNames.map { n in UIAction(title: n.0, image: swatch(n.1)) { [weak self] _ in self?.changeBox { $0.borderColor = n.1 } } })
    var fills: [UIAction] = [UIAction(title: "No fill") { [weak self] _ in self?.changeBox { $0.fill = nil } }]
    fills += [("Yellow", "#FFF7A8"), ("Blue", "#DFF0FC"), ("Green", "#D8F3DC"), ("Pink", "#FFD6E0"), ("Grey", "#ECEDF1"), ("White", "#FFFFFF")].map { n in
      UIAction(title: n.0, image: swatch(n.1)) { [weak self] _ in self?.changeBox { $0.fill = n.1 } }
    }
    style.menu = UIMenu(children: [borders, widths, edge, UIMenu(title: "Fill", children: fills)])
    style.showsMenuAsPrimaryAction = true
    bar.addArrangedSubview(style)
    bar.addArrangedSubview(barButton("doc.on.doc", label: "Duplicate box") { [weak self] in self?.duplicateBox() })
    bar.addArrangedSubview(barButton("scissors", label: "Cut box") { [weak self] in self?.copyBox(); self?.deleteBox() })
    bar.addArrangedSubview(barButton("square.on.square.dashed", label: "Copy box") { [weak self] in self?.copyBox() })
    bar.addArrangedSubview(barButton("lock", label: "Lock box") { [weak self] in self?.changeBox { $0.locked = !($0.locked ?? false) } })
    let layer = UIButton(type: .system)
    layer.setImage(UIImage(systemName: "square.3.layers.3d"), for: .normal)
    layer.tintColor = style.tintColor
    layer.accessibilityLabel = "Box layer"
    layer.contentEdgeInsets = style.contentEdgeInsets
    layer.menu = UIMenu(children: [
      UIAction(title: "Bring to front") { [weak self] _ in self?.reorderBox(front: true) },
      UIAction(title: "Send to back") { [weak self] _ in self?.reorderBox(front: false) },
    ])
    layer.showsMenuAsPrimaryAction = true
    bar.addArrangedSubview(layer)
    let del = barButton("trash", label: "Delete box") { [weak self] in self?.deleteBox() }
    del.tintColor = UIColor(red: 0.88, green: 0.2, blue: 0.25, alpha: 1)
    bar.addArrangedSubview(del)
    return bar
  }

  private func copyBox() {
    guard let i = editingIndex(), let ed = editor else { return }
    texts[i].text = ed.text ?? ""
    texts[i].rtf = rtfString(ed.attributedText)
    InkClipboard.strokes = []
    InkClipboard.texts = [texts[i]]
    InkClipboard.pics = []
    UIPasteboard.general.string = ed.text
    InkClipboard.changeCount = UIPasteboard.general.changeCount
  }

  private func duplicateBox() {
    guard let i = editingIndex() else { return }
    copyBox()
    var n = texts[i]
    n.id = UUID().uuidString
    n.x += 24
    n.y += 24
    commitEdit()
    texts.append(n)
    renderTexts()
    objectsChanged()
  }

  private func deleteBox() {
    guard let id = editingId, let ed = editor else { return }
    ed.text = ""
    _ = id
    commitEdit()
  }

  private func reorderBox(front: Bool) {
    guard let i = editingIndex() else { return }
    let b = texts.remove(at: i)
    if front { texts.append(b) } else { texts.insert(b, at: 0) }
  }

  /// Keeps the box bar right under the text box.
  func placeBoxBar() {
    guard let ed = editor, ed.superview != nil, editingId != nil else { boxBar?.isHidden = true; return }
    if boxBar == nil {
      let b = makeBoxBar()
      addSubview(b)
      boxBar = b
    }
    guard let bar = boxBar else { return }
    bar.isHidden = false
    bringSubviewToFront(bar)
    let r = textHost.convert(ed.frame, to: self)
    let size = bar.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize)
    let x = max(8, min(bounds.width - size.width - 8, r.midX - size.width / 2))
    var y = r.maxY + 10
    if y + size.height > bounds.height - keyboardInset - 8 { y = max(8, r.minY - size.height - 10) }
    bar.frame = CGRect(x: x, y: y, width: size.width, height: size.height)
  }
}
