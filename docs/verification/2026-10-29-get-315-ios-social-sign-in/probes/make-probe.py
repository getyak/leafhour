from pathlib import Path
import plistlib
repo=Path('/Users/cubxxw/.codex/worktrees/ios-connected-reader/leafhour')
root=Path(__file__).parent
app=repo/'apps/ios'
(root/'LeafhourAppModel.swift').write_text((app/'Leafhour/LeafhourApp.swift').read_text().replace('@main\n','',1))
info=plistlib.loads((app/'Leafhour/Info.plist').read_bytes())
info['NSAppTransportSecurity']={'NSAllowsLocalNetworking':True}
(root/'Info.plist').write_bytes(plistlib.dumps(info))
(root/'project.yml').write_text(f"""name: LeafhourGET315Probe
options:
  deploymentTarget:
    iOS: '17.0'
packages:
  LeafhourCore:
    path: {app/'LeafhourCore'}
settings:
  base:
    SWIFT_VERSION: '5.9'
    IPHONEOS_DEPLOYMENT_TARGET: '17.0'
    CODE_SIGNING_ALLOWED: NO
    TARGETED_DEVICE_FAMILY: '1,2'
    MARKETING_VERSION: '0.1.0'
    CURRENT_PROJECT_VERSION: '1'
targets:
  Leafhour:
    type: application
    platform: iOS
    sources:
      - path: {app/'Leafhour'}
        excludes: [LeafhourApp.swift, Info.plist]
      - path: LeafhourAppModel.swift
      - path: ProbeApp.swift
    dependencies:
      - package: LeafhourCore
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: org.leafhour.get315-probe
        INFOPLIST_FILE: Info.plist
        GENERATE_INFOPLIST_FILE: NO
  LeafhourProbeUITests:
    type: bundle.ui-testing
    platform: iOS
    sources: [ProbeUITests.swift]
    dependencies:
      - target: Leafhour
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: org.leafhour.get315-probe.uitests
        GENERATE_INFOPLIST_FILE: YES
schemes:
  Leafhour:
    build:
      targets:
        Leafhour: all
    test:
      config: Debug
      targets: [LeafhourProbeUITests]
""")
