import Compression
import Foundation

/// Unpacks an everyday .zip (stored or deflated files; not encrypted, not over 4 GB). The zip is
/// memory-mapped, so even a big one isn't read into memory at once.
enum Unzip {
  struct Failure: LocalizedError {
    let text: String
    var errorDescription: String? { text }
  }

  /// Unpacks `zipPath` into `rel` (inside the app's Documents folder). Returns each file's path inside it.
  static func run(_ zipPath: String, into rel: String) throws -> [String] {
    let data = try Data(contentsOf: URL(fileURLWithPath: zipPath), options: .alwaysMapped)
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let dest = docs.appendingPathComponent(rel, isDirectory: true)
    try FileManager.default.createDirectory(at: dest, withIntermediateDirectories: true)
    let n = data.count
    guard n >= 22 else { throw Failure(text: "That isn't a zip file.") }
    // The directory at the end lists every file.
    var end = -1
    var i = n - 22
    let stop = max(0, n - 22 - 65_535)
    while i >= stop {
      if u32(data, i) == 0x0605_4B50 { end = i; break }
      i -= 1
    }
    guard end >= 0 else { throw Failure(text: "That isn't a zip file.") }
    let count = Int(u16(data, end + 10))
    var p = Int(u32(data, end + 16))
    var out: [String] = []
    for _ in 0..<count {
      guard p + 46 <= n, u32(data, p) == 0x0201_4B50 else { break }
      let method = u16(data, p + 10)
      let packed = Int(u32(data, p + 20)), size = Int(u32(data, p + 24))
      let nameLen = Int(u16(data, p + 28)), extraLen = Int(u16(data, p + 30)), noteLen = Int(u16(data, p + 32))
      let local = Int(u32(data, p + 42))
      guard p + 46 + nameLen <= n else { break }
      let nameData = data.subdata(in: (p + 46)..<(p + 46 + nameLen))
      p += 46 + nameLen + extraLen + noteLen
      let name = (String(data: nameData, encoding: .utf8) ?? String(data: nameData, encoding: .isoLatin1) ?? "file")
        .replacingOccurrences(of: "\\", with: "/")
      let parts = name.split(separator: "/")
      // Folders, Mac leftovers, hidden files, and anything trying to climb out of the folder.
      if name.hasSuffix("/") || parts.first == "__MACOSX" || parts.contains(where: { $0.hasPrefix(".") }) || parts.isEmpty { continue }
      if packed == 0xFFFF_FFFF || size == 0xFFFF_FFFF { continue }
      guard local + 30 <= n, u32(data, local) == 0x0403_4B50 else { continue }
      let start = local + 30 + Int(u16(data, local + 26)) + Int(u16(data, local + 28))
      guard start + packed <= n else { continue }
      let raw = data.subdata(in: start..<(start + packed))
      let bytes: Data
      if method == 0 { bytes = raw }
      else if method == 8, let d = inflate(raw, size: size) { bytes = d }
      else { continue }
      let clean = parts.joined(separator: "/")
      let file = dest.appendingPathComponent(clean)
      try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
      try bytes.write(to: file)
      out.append(clean)
    }
    return out
  }

  private static func inflate(_ raw: Data, size: Int) -> Data? {
    if size == 0 { return Data() }
    var dst = Data(count: size)
    let written = dst.withUnsafeMutableBytes { (d: UnsafeMutableRawBufferPointer) -> Int in
      raw.withUnsafeBytes { (s: UnsafeRawBufferPointer) -> Int in
        guard let to = d.bindMemory(to: UInt8.self).baseAddress, let from = s.bindMemory(to: UInt8.self).baseAddress else { return 0 }
        return compression_decode_buffer(to, size, from, raw.count, nil, COMPRESSION_ZLIB)
      }
    }
    return written == size ? dst : nil
  }

  private static func u16(_ d: Data, _ i: Int) -> UInt16 { UInt16(d[i]) | UInt16(d[i + 1]) << 8 }
  private static func u32(_ d: Data, _ i: Int) -> UInt32 {
    UInt32(d[i]) | UInt32(d[i + 1]) << 8 | UInt32(d[i + 2]) << 16 | UInt32(d[i + 3]) << 24
  }
}
