Pod::Spec.new do |s|
  s.name           = 'MuqunAppStorage'
  s.version        = '1.0.0'
  s.summary        = 'Storage housekeeping for Muqun'
  s.description    = 'Process launch claim and storage statistics for the cache cleanup'
  s.author         = 'osuki-dev'
  s.homepage       = 'https://github.com/osuki-dev/muqun-app'
  s.license        = { :type => 'MIT', :file => '../LICENSE' }
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: 'https://github.com/osuki-dev/muqun-app.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "*.swift"
end
