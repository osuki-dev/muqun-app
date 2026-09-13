Pod::Spec.new do |s|
  s.name           = 'MuqunThemeTransport'
  s.version        = '1.0.0'
  s.summary        = 'Bounded public HTTPS transport for Muqun theme imports'
  s.description    = 'Pinned public destination sockets with host-validated TLS and bounded HTTP responses'
  s.author         = 'osuki-dev'
  s.homepage       = 'https://github.com/osuki-dev/muqun-app'
  s.license        = { :type => 'MIT', :file => '../LICENSE' }
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: 'https://github.com/osuki-dev/muqun-app.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "*.swift"
  s.frameworks = 'Security'
  # DNSService symbols are exported by iOS libSystem; there is no separate
  # simulator libdns_sd to link (unlike some desktop SDK configurations).
end
