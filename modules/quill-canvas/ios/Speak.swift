// Reading text aloud, and Apple's dictionary. Both work with no internet.
import AVFoundation
import NaturalLanguage
import UIKit

enum Speak {
  private static let voice = AVSpeechSynthesizer()

  /// Speaks in whatever language the text is written in, so Hebrew comes out as Hebrew. Saying it again stops it.
  static func say(_ text: String) {
    if voice.isSpeaking {
      voice.stopSpeaking(at: .immediate)
      return
    }
    let u = AVSpeechUtterance(string: text)
    u.rate = AVSpeechUtteranceDefaultSpeechRate
    if let lang = NLLanguageRecognizer.dominantLanguage(for: text)?.rawValue, let v = AVSpeechSynthesisVoice(language: lang) { u.voice = v }
    voice.speak(u)
  }

  static func stop() { voice.stopSpeaking(at: .immediate) }

  static func define(_ word: String, from vc: UIViewController) {
    vc.present(UIReferenceLibraryViewController(term: word), animated: true)
  }
}
