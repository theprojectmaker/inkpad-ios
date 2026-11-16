// "Share to Quill", shown inside the share sheet of whatever app the file is in. It asks where the
// file should go (a new note with a name and a folder, or onto the end of a note that's already
// there), puts the file where Quill can read it, and leaves a note for Quill saying what to do with
// it. Quill does the importing the next time it is open; "Continue to Quill note" opens it now.
//
// What it knows about the library (folders and recent notes) is a small list Quill keeps in the
// shared app group. <GROUPIDENTIFIER> and <SCHEME> are filled in when the project is made.
import UIKit
import UniformTypeIdentifiers

final class QuillActionViewController: UIViewController, UITableViewDataSource, UITableViewDelegate, UITextFieldDelegate {
  private let group = "<GROUPIDENTIFIER>"
  private let scheme = "<SCHEME>"

  private struct Shared { let path: String; let fileName: String; let mimeType: String }
  private struct Folder { let id: String; let name: String; let color: UIColor }
  private struct Note { let id: String; let title: String; let detail: String }
  private enum Mode { case last, new, existing }
  private enum Section { case file, options, title, folder, notes }

  private var files: [Shared] = []
  private var folders: [Folder] = []
  private var notes: [Note] = []
  private var mode: Mode = .new
  private var into: String?
  private var folderId: String?
  private var thumb: UIImage?
  private var loading = true
  private var pendingId: String?

  private let table = UITableView(frame: .zero, style: .insetGrouped)
  private let bar = UIView()
  private let heading = UILabel()
  private let closeButton = UIButton(type: .system)
  private let importButton = UIButton(type: .system)
  private let titleField = UITextField()
  private let spinner = UIActivityIndicatorView(style: .medium)
  private let blue = UIColor(red: 0, green: 0.478, blue: 1, alpha: 1)

  private var sections: [Section] {
    if loading { return [] }
    switch mode {
    case .new: return [.file, .options, .title, .folder]
    case .existing: return [.file, .options, .notes]
    case .last: return [.file, .options]
    }
  }

  // MARK: - Setting up

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemGroupedBackground
    readLibrary()
    buildBar()
    table.dataSource = self
    table.delegate = self
    table.keyboardDismissMode = .onDrag
    table.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(table)
    spinner.translatesAutoresizingMaskIntoConstraints = false
    spinner.startAnimating()
    view.addSubview(spinner)
    NSLayoutConstraint.activate([
      table.topAnchor.constraint(equalTo: bar.bottomAnchor),
      table.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      table.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      table.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor),
    ])
    titleField.placeholder = "Note title"
    titleField.font = .systemFont(ofSize: 17)
    titleField.clearButtonMode = .whileEditing
    titleField.returnKeyType = .done
    titleField.delegate = self
    loadFiles()
  }

  private func buildBar() {
    bar.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(bar)
    heading.text = "Import to Quill"
    heading.font = .systemFont(ofSize: 17, weight: .bold)
    heading.textAlignment = .center
    closeButton.setImage(UIImage(systemName: "xmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 15, weight: .semibold)), for: .normal)
    closeButton.tintColor = .label
    closeButton.backgroundColor = .secondarySystemGroupedBackground
    closeButton.layer.cornerRadius = 22
    closeButton.accessibilityLabel = "Close"
    closeButton.addTarget(self, action: #selector(close), for: .touchUpInside)
    importButton.setTitle("Import", for: .normal)
    importButton.setTitleColor(.white, for: .normal)
    importButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .bold)
    importButton.backgroundColor = blue
    importButton.layer.cornerRadius = 22
    importButton.isEnabled = false
    importButton.alpha = 0.4
    importButton.addTarget(self, action: #selector(doImport), for: .touchUpInside)
    for v in [heading, closeButton, importButton] {
      v.translatesAutoresizingMaskIntoConstraints = false
      bar.addSubview(v)
    }
    NSLayoutConstraint.activate([
      bar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      bar.heightAnchor.constraint(equalToConstant: 68),
      closeButton.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 14),
      closeButton.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
      closeButton.widthAnchor.constraint(equalToConstant: 44),
      closeButton.heightAnchor.constraint(equalToConstant: 44),
      importButton.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -14),
      importButton.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
      importButton.widthAnchor.constraint(equalToConstant: 96),
      importButton.heightAnchor.constraint(equalToConstant: 44),
      heading.centerXAnchor.constraint(equalTo: bar.centerXAnchor),
      heading.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
    ])
  }

  /// The folders and recent notes, as Quill last wrote them down.
  private func readLibrary() {
    guard let text = UserDefaults(suiteName: group)?.string(forKey: "quillShareLibrary"),
          let data = text.data(using: .utf8),
          let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
    for f in root["folders"] as? [[String: Any]] ?? [] {
      guard let id = f["id"] as? String, let name = f["name"] as? String else { continue }
      folders.append(Folder(id: id, name: name, color: colour(f["color"] as? String)))
    }
    for n in root["notes"] as? [[String: Any]] ?? [] {
      guard let id = n["id"] as? String, let title = n["title"] as? String else { continue }
      notes.append(Note(id: id, title: title, detail: n["detail"] as? String ?? ""))
    }
  }

  private func colour(_ hex: String?) -> UIColor {
    var s = (hex ?? "").trimmingCharacters(in: .whitespaces)
    if s.hasPrefix("#") { s.removeFirst() }
    var v: UInt64 = 0
    guard s.count == 6, Scanner(string: s).scanHexInt64(&v) else { return .systemGray }
    return UIColor(red: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
  }

  /// Copies what was shared into the app group, where Quill can read it.
  private func loadFiles() {
    let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
    guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?.appendingPathComponent("QuillInbox", isDirectory: true) else {
      finishLoading([])
      return
    }
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let waiting = DispatchGroup()
    let lock = NSLock()
    var found: [(Int, Shared)] = []
    for (i, p) in providers.enumerated() {
      let isPdf = p.hasItemConformingToTypeIdentifier(UTType.pdf.identifier)
      guard isPdf || p.hasItemConformingToTypeIdentifier(UTType.image.identifier) else { continue }
      let type = isPdf ? UTType.pdf : UTType.image
      let suggested = p.suggestedName
      waiting.enter()
      p.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
        defer { waiting.leave() }
        guard let url else { return }
        let ext = url.pathExtension.isEmpty ? (isPdf ? "pdf" : "jpg") : url.pathExtension
        let dst = dir.appendingPathComponent("\(UUID().uuidString).\(ext)")
        guard (try? FileManager.default.copyItem(at: url, to: dst)) != nil else { return }
        var name = suggested ?? url.lastPathComponent
        if !name.lowercased().hasSuffix(".\(ext.lowercased())") { name += ".\(ext)" }
        let mime = isPdf ? "application/pdf" : (UTType(filenameExtension: ext)?.preferredMIMEType ?? "image/jpeg")
        lock.lock()
        found.append((i, Shared(path: dst.absoluteString, fileName: name, mimeType: mime)))
        lock.unlock()
      }
    }
    waiting.notify(queue: .main) { [weak self] in
      self?.finishLoading(found.sorted { $0.0 < $1.0 }.map { $0.1 })
    }
  }

  private func finishLoading(_ list: [Shared]) {
    files = list
    loading = false
    spinner.stopAnimating()
    guard let first = list.first else {
      showMessage(symbol: "exclamationmark.circle", tint: .systemOrange, title: "Nothing Quill can import", detail: "Share a PDF or photos to add them to your notes.", primary: nil)
      return
    }
    let base = (first.fileName as NSString).deletingPathExtension
    titleField.text = base.isEmpty ? "Shared note" : base
    thumb = preview(of: first)
    importButton.isEnabled = true
    importButton.alpha = 1
    table.reloadData()
  }

  /// A small picture of the first file: the PDF's first page, or the photo.
  private func preview(of f: Shared) -> UIImage? {
    guard let url = URL(string: f.path) else { return nil }
    let box = CGSize(width: 116, height: 144)
    if f.mimeType == "application/pdf" {
      guard let doc = CGPDFDocument(url as CFURL), let page = doc.page(at: 1) else { return nil }
      return UIGraphicsImageRenderer(size: box).image { c in
        UIColor.white.setFill()
        c.fill(CGRect(origin: .zero, size: box))
        c.cgContext.translateBy(x: 0, y: box.height)
        c.cgContext.scaleBy(x: 1, y: -1)
        c.cgContext.concatenate(page.getDrawingTransform(.cropBox, rect: CGRect(origin: .zero, size: box), rotate: 0, preserveAspectRatio: true))
        c.cgContext.drawPDFPage(page)
      }
    }
    guard let image = UIImage(contentsOfFile: url.path) else { return nil }
    return UIGraphicsImageRenderer(size: box).image { _ in
      let k = max(box.width / max(1, image.size.width), box.height / max(1, image.size.height))
      let size = CGSize(width: image.size.width * k, height: image.size.height * k)
      image.draw(in: CGRect(x: (box.width - size.width) / 2, y: (box.height - size.height) / 2, width: size.width, height: size.height))
    }
  }

  // MARK: - The form

  func numberOfSections(in tableView: UITableView) -> Int { sections.count }

  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
    switch sections[section] {
    case .file, .title: return 1
    case .options: return notes.isEmpty ? 1 : 3
    case .folder: return folders.count + 1
    case .notes: return notes.count
    }
  }

  func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
    switch sections[section] {
    case .file: return nil
    case .options: return "Import options"
    case .title: return "Note title"
    case .folder: return "Folder"
    case .notes: return "Add to"
    }
  }

  func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
    switch sections[section] {
    case .options: return mode == .new ? nil : "The pages go on the end of that note."
    case .title: return "Tap the title to rename it."
    default: return nil
    }
  }

  func tableView(_ tableView: UITableView, heightForRowAt indexPath: IndexPath) -> CGFloat {
    sections[indexPath.section] == .file ? 96 : 54
  }

  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
    var c = cell.defaultContentConfiguration()
    c.textProperties.font = .systemFont(ofSize: 17)
    cell.accessoryType = .none
    switch sections[indexPath.section] {
    case .file:
      cell.selectionStyle = .none
      c.text = files.count == 1 ? files[0].fileName : "\(files[0].fileName) and \(files.count - 1) more"
      c.textProperties.numberOfLines = 2
      c.image = thumb ?? UIImage(systemName: "doc")
      c.imageProperties.maximumSize = CGSize(width: 58, height: 72)
      c.imageProperties.cornerRadius = 5
    case .options:
      let rows: [(String, Mode)] = notes.isEmpty ? [("Create new note", .new)] : [("Add to “\(notes[0].title)”", .last), ("Create new note", .new), ("Add to existing note", .existing)]
      c.text = rows[indexPath.row].0
      cell.accessoryType = rows[indexPath.row].1 == mode ? .checkmark : .none
    case .title:
      cell.selectionStyle = .none
      titleField.removeFromSuperview()
      titleField.translatesAutoresizingMaskIntoConstraints = false
      cell.contentView.addSubview(titleField)
      NSLayoutConstraint.activate([
        titleField.leadingAnchor.constraint(equalTo: cell.contentView.layoutMarginsGuide.leadingAnchor),
        titleField.trailingAnchor.constraint(equalTo: cell.contentView.layoutMarginsGuide.trailingAnchor),
        titleField.topAnchor.constraint(equalTo: cell.contentView.topAnchor),
        titleField.bottomAnchor.constraint(equalTo: cell.contentView.bottomAnchor),
      ])
      return cell
    case .folder:
      let f = indexPath.row == 0 ? nil : folders[indexPath.row - 1]
      c.text = f?.name ?? "No subject"
      c.image = UIImage(systemName: "circle.fill")
      c.imageProperties.tintColor = f?.color ?? .systemGray3
      c.imageProperties.maximumSize = CGSize(width: 14, height: 14)
      cell.accessoryType = f?.id == folderId ? .checkmark : .none
    case .notes:
      let n = notes[indexPath.row]
      c.text = n.title
      c.secondaryText = n.detail
      c.secondaryTextProperties.color = .secondaryLabel
      cell.accessoryType = n.id == into ? .checkmark : .none
    }
    cell.tintColor = .label
    cell.contentConfiguration = c
    return cell
  }

  func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    switch sections[indexPath.section] {
    case .options:
      let order: [Mode] = notes.isEmpty ? [.new] : [.last, .new, .existing]
      mode = order[indexPath.row]
      if mode == .existing, into == nil { into = notes.first?.id }
      view.endEditing(true)
    case .folder:
      folderId = indexPath.row == 0 ? nil : folders[indexPath.row - 1].id
    case .notes:
      into = notes[indexPath.row].id
    default:
      return
    }
    tableView.reloadData()
  }

  func textFieldShouldReturn(_ textField: UITextField) -> Bool {
    textField.resignFirstResponder()
    return true
  }

  // MARK: - Importing

  @objc private func doImport() {
    guard !files.isEmpty else { return }
    view.endEditing(true)
    let id = UUID().uuidString
    var entry: [String: Any] = [
      "id": id,
      "mode": mode == .new ? "new" : "existing",
      "title": (titleField.text ?? "").trimmingCharacters(in: .whitespaces),
      "files": files.map { ["path": $0.path, "fileName": $0.fileName, "mimeType": $0.mimeType] },
      "at": Date().timeIntervalSince1970,
    ]
    if let folderId { entry["folderId"] = folderId }
    if mode != .new, let target = mode == .last ? notes.first?.id : into { entry["into"] = target }
    let store = UserDefaults(suiteName: group)
    var list = store?.array(forKey: "quillPendingImports") as? [[String: Any]] ?? []
    list.append(entry)
    store?.set(list, forKey: "quillPendingImports")
    pendingId = id
    let where_ = mode == .new ? (entry["title"] as? String ?? "") : (mode == .last ? notes.first?.title : notes.first { $0.id == into }?.title) ?? "your note"
    showMessage(symbol: "checkmark.circle.fill", tint: .systemGreen, title: "Saved for Quill",
                detail: "It will be in “\(where_)” the next time Quill is open.", primary: "Continue to Quill note")
  }

  /// The little screen at the end: what happened, and what to do next.
  private func showMessage(symbol: String, tint: UIColor, title: String, detail: String, primary: String?) {
    table.isHidden = true
    importButton.isHidden = true
    heading.text = "Quill"
    let icon = UIImageView(image: UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 46, weight: .regular)))
    icon.tintColor = tint
    let head = UILabel()
    head.text = title
    head.font = .systemFont(ofSize: 22, weight: .bold)
    head.textAlignment = .center
    let body = UILabel()
    body.text = detail
    body.font = .systemFont(ofSize: 16)
    body.textColor = .secondaryLabel
    body.textAlignment = .center
    body.numberOfLines = 0
    let stack = UIStackView(arrangedSubviews: [icon, head, body])
    stack.axis = .vertical
    stack.alignment = .center
    stack.spacing = 10
    stack.setCustomSpacing(26, after: body)
    if let primary {
      let go = UIButton(type: .system)
      go.setTitle(primary, for: .normal)
      go.setTitleColor(.white, for: .normal)
      go.titleLabel?.font = .systemFont(ofSize: 17, weight: .bold)
      go.backgroundColor = blue
      go.layer.cornerRadius = 14
      go.addTarget(self, action: #selector(continueToQuill), for: .touchUpInside)
      go.translatesAutoresizingMaskIntoConstraints = false
      stack.addArrangedSubview(go)
      NSLayoutConstraint.activate([go.heightAnchor.constraint(equalToConstant: 52), go.widthAnchor.constraint(equalTo: stack.widthAnchor)])
    }
    let done = UIButton(type: .system)
    done.setTitle("Close", for: .normal)
    done.titleLabel?.font = .systemFont(ofSize: 17)
    done.addTarget(self, action: #selector(close), for: .touchUpInside)
    done.translatesAutoresizingMaskIntoConstraints = false
    stack.addArrangedSubview(done)
    done.heightAnchor.constraint(equalToConstant: 44).isActive = true
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      stack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      stack.widthAnchor.constraint(lessThanOrEqualToConstant: 340),
      stack.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
      stack.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24),
    ])
  }

  @objc private func continueToQuill() {
    // Tell Quill to open the note once it has been imported.
    let store = UserDefaults(suiteName: group)
    if let id = pendingId, var list = store?.array(forKey: "quillPendingImports") as? [[String: Any]],
       let i = list.firstIndex(where: { $0["id"] as? String == id }) {
      list[i]["open"] = true
      store?.set(list, forKey: "quillPendingImports")
    }
    if let url = URL(string: "\(scheme)://import") {
      var responder: UIResponder? = self
      while let r = responder {
        if let app = r as? UIApplication { app.open(url, options: [:], completionHandler: nil); break }
        responder = r.next
      }
    }
    extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
  }

  @objc private func close() {
    // Closed without importing: the copies made for Quill aren't needed.
    if pendingId == nil {
      for f in files { if let url = URL(string: f.path) { try? FileManager.default.removeItem(at: url) } }
    }
    extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
  }
}
