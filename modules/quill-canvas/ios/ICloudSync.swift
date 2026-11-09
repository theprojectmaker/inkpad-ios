import Foundation

/// Notes in iCloud Drive: Quill's own container (it doesn't show in the Files app). Each note is a
/// folder, copied file by file; iOS does the uploading and downloading. Paths given here are relative:
/// on this iPad to the app's Documents folder, in iCloud to the container's Documents/Quill folder.
enum ICloudSync {
  static let containerId = "iCloud.com.solyapps.notes"
  private static let fm = FileManager.default

  private static var local: URL { fm.urls(for: .documentDirectory, in: .userDomainMask)[0] }

  /// iCloud's folder for Quill, or nil if there's no iCloud account, iCloud Drive is off, or this
  /// build of the app isn't allowed to use iCloud.
  static func root() -> URL? {
    guard fm.ubiquityIdentityToken != nil, let c = fm.url(forUbiquityContainerIdentifier: containerId) else { return nil }
    let r = c.appendingPathComponent("Documents/Quill", isDirectory: true)
    try? fm.createDirectory(at: r, withIntermediateDirectories: true)
    return r
  }

  static func status() -> String {
    if fm.url(forUbiquityContainerIdentifier: containerId) == nil {
      return fm.ubiquityIdentityToken == nil ? "signed-out" : "unavailable"
    }
    return fm.ubiquityIdentityToken == nil ? "signed-out" : "on"
  }

  /// Copies a whole note folder up: only files that are new or changed. Old versions stay on the iPad.
  static func pushDir(_ rel: String, to cloudRel: String) -> Int {
    guard let root = root() else { return -1 }
    let from = local.appendingPathComponent(rel, isDirectory: true)
    let to = root.appendingPathComponent(cloudRel, isDirectory: true)
    guard let walk = fm.enumerator(at: from, includingPropertiesForKeys: [.isDirectoryKey, .contentModificationDateKey, .fileSizeKey]) else { return 0 }
    var copied = 0
    for case let url as URL in walk {
      let name = url.lastPathComponent
      let inside = String(url.path.dropFirst(from.path.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
      if inside.hasPrefix("versions") { walk.skipDescendants(); continue }
      if name.hasSuffix(".tmp") || name.hasSuffix(".bak") || name.hasPrefix(".") { continue }
      let v = try? url.resourceValues(forKeys: [.isDirectoryKey, .contentModificationDateKey, .fileSizeKey])
      if v?.isDirectory == true { continue }
      let dest = to.appendingPathComponent(inside)
      let there = try? dest.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
      if let there, let a = v?.contentModificationDate, let b = there.contentModificationDate, a <= b, v?.fileSize == there.fileSize { continue }
      if copy(url, to: dest) { copied += 1 }
    }
    return copied
  }

  /// Brings a note folder down: every file that's newer in iCloud or missing here.
  static func pullDir(_ cloudRel: String, to rel: String) -> Int {
    guard let root = root() else { return -1 }
    let from = root.appendingPathComponent(cloudRel, isDirectory: true)
    let to = local.appendingPathComponent(rel, isDirectory: true)
    var copied = 0
    func walk(_ dir: URL, _ prefix: String) {
      for name in names(in: dir) {
        let url = dir.appendingPathComponent(name)
        var isDir: ObjCBool = false
        if fm.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue { walk(url, prefix + name + "/"); continue }
        guard download(url) else { continue }
        let dest = to.appendingPathComponent(prefix + name)
        let a = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
        let b = (try? dest.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
        if let a, let b, a <= b, fm.fileExists(atPath: dest.path) { continue }
        if copy(url, to: dest) { copied += 1 }
      }
    }
    walk(from, "")
    return copied
  }

  static func readText(_ cloudRel: String) -> String? {
    guard let root = root() else { return nil }
    let url = root.appendingPathComponent(cloudRel)
    guard download(url) else { return nil }
    var out: String?
    var err: NSError?
    NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &err) { u in out = try? String(contentsOf: u, encoding: .utf8) }
    return out
  }

  static func writeText(_ cloudRel: String, _ text: String) -> Bool {
    guard let root = root() else { return false }
    let url = root.appendingPathComponent(cloudRel)
    try? fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    var ok = false
    var err: NSError?
    NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &err) { u in
      ok = (try? text.write(to: u, atomically: true, encoding: .utf8)) != nil
    }
    return ok && err == nil
  }

  static func remove(_ cloudRel: String) {
    guard let root = root() else { return }
    let url = root.appendingPathComponent(cloudRel)
    var err: NSError?
    NSFileCoordinator().coordinate(writingItemAt: url, options: .forDeleting, error: &err) { u in try? fm.removeItem(at: u) }
  }

  // MARK: - Files

  private static func copy(_ from: URL, to: URL) -> Bool {
    var ok = false
    var err: NSError?
    NSFileCoordinator().coordinate(readingItemAt: from, options: [], writingItemAt: to, options: .forReplacing, error: &err) { r, w in
      do {
        try fm.createDirectory(at: w.deletingLastPathComponent(), withIntermediateDirectories: true)
        if fm.fileExists(atPath: w.path) { try fm.removeItem(at: w) }
        try fm.copyItem(at: r, to: w)
        ok = true
      } catch { ok = false }
    }
    return ok && err == nil
  }

  /// Names in an iCloud folder. A file that isn't on this iPad yet shows up as ".name.icloud".
  private static func names(in dir: URL) -> [String] {
    let items = (try? fm.contentsOfDirectory(atPath: dir.path)) ?? []
    var out = Set<String>()
    for n in items {
      if n.hasPrefix(".") && n.hasSuffix(".icloud") { out.insert(String(n.dropFirst().dropLast(7))) }
      else if !n.hasPrefix(".") { out.insert(n) }
    }
    return out.sorted()
  }

  /// Asks iCloud for the file and waits (a while) until it's here.
  private static func download(_ url: URL, timeout: TimeInterval = 30) -> Bool {
    if isHere(url) { return true }
    try? fm.startDownloadingUbiquitousItem(at: url)
    let end = Date().addingTimeInterval(timeout)
    while Date() < end {
      if isHere(url) { return true }
      Thread.sleep(forTimeInterval: 0.25)
    }
    return false
  }

  private static func isHere(_ url: URL) -> Bool {
    let v = try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey])
    if let s = v?.ubiquitousItemDownloadingStatus { return s == .current }
    return fm.fileExists(atPath: url.path)
  }
}
