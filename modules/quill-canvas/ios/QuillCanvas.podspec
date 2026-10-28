Pod::Spec.new do |s|
  s.name           = 'QuillCanvas'
  s.version        = '1.0.0'
  s.summary        = 'Quill writing canvas (PencilKit)'
  s.description    = 'A PencilKit canvas with stacked pages, PDF backgrounds and PDF export.'
  s.license        = 'MIT'
  s.author         = 'Quill'
  s.homepage       = 'https://example.com/quill'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'PencilKit', 'PDFKit', 'Vision', 'CoreImage'
  # Apple's on-device model is only on iOS 26; weak-linked so older iPads still open the app.
  s.weak_frameworks = 'FoundationModels'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
  s.source_files = "**/*.{h,m,swift}"
end
